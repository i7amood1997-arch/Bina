-- ---------- membership helper ----------
create or replace function hb_is_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from hb_project_members m where m.project_id = pid and m.user_id = auth.uid());
$$;

-- ---------- RLS: any member reads and writes everything in their project ----------
do $$
declare t text;
begin
  foreach t in array array['hb_projects','hb_payers','hb_vendors','hb_commitments','hb_milestones',
    'hb_variations','hb_payments','hb_documents','hb_document_links','hb_warranties','hb_site_log','hb_ai_corrections']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_member_all on %I', t, t);
    execute format('create policy %I_member_all on %I for all to authenticated using (hb_is_member(project_id)) with check (hb_is_member(project_id))', t, t);
  end loop;
end $$;

alter table hb_project_members enable row level security;
drop policy if exists hb_members_read on hb_project_members;
create policy hb_members_read on hb_project_members for select to authenticated
  using (hb_is_member(project_id));
drop policy if exists hb_members_update_self on hb_project_members;
create policy hb_members_update_self on hb_project_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table hb_audit_log enable row level security;
drop policy if exists hb_audit_read on hb_audit_log;
create policy hb_audit_read on hb_audit_log for select to authenticated using (hb_is_member(project_id));
-- no insert/update/delete policies: only the trigger (security definer) writes here

-- ---------- audit trigger ----------
create or replace function hb_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text;
begin
  if tg_op = 'INSERT' then
    act := 'insert';
    insert into hb_audit_log(project_id, entity_type, entity_id, action, before, after, user_id)
      values (new.project_id, tg_table_name, new.id, act, null, to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then act := 'delete';
    elsif old.deleted_at is not null and new.deleted_at is null then act := 'restore';
    else act := 'update';
    end if;
    -- skip no-op updates
    if (to_jsonb(old) - 'updated_at' - 'updated_by') = (to_jsonb(new) - 'updated_at' - 'updated_by') then
      return new;
    end if;
    insert into hb_audit_log(project_id, entity_type, entity_id, action, before, after, user_id)
      values (new.project_id, tg_table_name, new.id, act, to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  else
    insert into hb_audit_log(project_id, entity_type, entity_id, action, before, after, user_id)
      values (old.project_id, tg_table_name, old.id, 'purge', to_jsonb(old), null, auth.uid());
    return old;
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['hb_projects','hb_payers','hb_vendors','hb_commitments','hb_milestones',
    'hb_variations','hb_payments','hb_documents','hb_document_links','hb_warranties','hb_site_log']
  loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function hb_audit()', t, t);
  end loop;
end $$;

-- ---------- realtime ----------
do $$
declare t text;
begin
  foreach t in array array['hb_projects','hb_payers','hb_vendors','hb_commitments','hb_milestones',
    'hb_variations','hb_payments','hb_documents','hb_document_links','hb_ai_corrections','hb_audit_log']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- 30-day trash purge ----------
create or replace function hb_purge_trash() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from hb_document_links where deleted_at < now() - interval '30 days';
  delete from hb_payments      where deleted_at < now() - interval '30 days';
  delete from hb_milestones    where deleted_at < now() - interval '30 days';
  delete from hb_variations    where deleted_at < now() - interval '30 days';
  delete from hb_documents     where deleted_at < now() - interval '30 days';
  delete from hb_commitments   where deleted_at < now() - interval '30 days';
  delete from hb_vendors       where deleted_at < now() - interval '30 days';
  delete from hb_payers        where deleted_at < now() - interval '30 days';
end $$;

-- Requires the pg_cron extension (Dashboard → Database → Extensions → pg_cron → enable).
create extension if not exists pg_cron;
select cron.unschedule('hb-purge-trash') where exists (select 1 from cron.job where jobname = 'hb-purge-trash');
select cron.schedule('hb-purge-trash', '15 3 * * *', 'select hb_purge_trash()');
