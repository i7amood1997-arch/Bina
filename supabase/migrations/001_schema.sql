-- House Build Manager — schema
-- All tables are prefixed hb_ so they can live in the same Supabase project as other apps.
-- All money columns are integer fils (1 BD = 1000 fils).

create extension if not exists pgcrypto;

-- ---------- shared columns trigger ----------
create or replace function hb_touch() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ---------- core ----------
create table if not exists hb_projects (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,                       -- equals id; kept so every table has project_id
  name text not null,
  plot_no text,
  location text,
  contingency_pct numeric(5,2) not null default 10,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_project_members (
  project_id uuid not null references hb_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists hb_payers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  name text not null,
  user_id uuid references auth.users(id),
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_vendors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  name text not null,
  category text not null default 'other',
  contact_name text,
  phone text,
  cr_no text,
  notes text,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_commitments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  vendor_id uuid references hb_vendors(id) on delete set null,
  type text not null check (type in ('staged_contract','direct_purchase','estimate')),
  title text not null,
  category text not null default 'other',
  original_amount bigint not null default 0 check (original_amount >= 0),
  status text not null default 'approved' check (status in ('estimated','approved','cancelled')),
  signed_date date,
  retention_pct numeric(5,2),
  ref_no text,
  notes text,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  commitment_id uuid not null references hb_commitments(id) on delete cascade,
  sort_order int not null default 0,
  title text not null,
  amount bigint not null default 0 check (amount >= 0),
  due_trigger text,
  due_date date,
  marked_due boolean not null default false,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_variations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  commitment_id uuid not null references hb_commitments(id) on delete cascade,
  title text not null,
  amount bigint not null,                 -- signed: negative = scope removed
  reason text not null,
  date date not null,
  status text not null default 'approved' check (status in ('proposed','approved','rejected')),
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_payments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  commitment_id uuid not null references hb_commitments(id) on delete cascade,
  milestone_id uuid references hb_milestones(id) on delete set null,
  kind text not null default 'normal' check (kind in ('normal','retention_release')),
  amount bigint not null check (amount > 0),
  date date not null,
  method text not null default 'bank_transfer',
  payer_id uuid not null references hb_payers(id),
  ref_no text,
  retention_held bigint not null default 0,
  notes text,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  type text not null default 'other',
  title text not null,
  date date,
  amount bigint,
  drive_file_id text,
  drive_url text,
  file_name text,
  mime text,
  size bigint,
  sha256 text,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);
create index if not exists hb_documents_sha on hb_documents(project_id, sha256);

create table if not exists hb_document_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  document_id uuid not null references hb_documents(id) on delete cascade,
  entity_type text not null check (entity_type in ('vendor','commitment','payment','milestone','variation')),
  entity_id uuid not null,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

-- phase 3 tables (schema only for now)
create table if not exists hb_warranties (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  vendor_id uuid references hb_vendors(id) on delete set null,
  commitment_id uuid references hb_commitments(id) on delete set null,
  item text not null,
  start_date date,
  years numeric(4,1),
  document_id uuid references hb_documents(id) on delete set null,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_site_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  date date not null,
  stage text,
  note text,
  document_ids uuid[] not null default '{}',
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_ai_corrections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hb_projects(id) on delete cascade,
  field text not null,
  extracted_value text,
  corrected_value text,
  vendor_id uuid,
  created_by uuid, created_at timestamptz, updated_by uuid, updated_at timestamptz, deleted_at timestamptz
);

create table if not exists hb_audit_log (
  id bigserial primary key,
  project_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,                  -- insert | update | delete | restore
  before jsonb,
  after jsonb,
  user_id uuid,
  at timestamptz not null default now()
);
create index if not exists hb_audit_entity on hb_audit_log(entity_type, entity_id);
create index if not exists hb_audit_at on hb_audit_log(project_id, at desc);

-- touch triggers
do $$
declare t text;
begin
  foreach t in array array['hb_projects','hb_payers','hb_vendors','hb_commitments','hb_milestones',
    'hb_variations','hb_payments','hb_documents','hb_document_links','hb_warranties','hb_site_log','hb_ai_corrections']
  loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before insert or update on %I for each row execute function hb_touch()', t, t);
  end loop;
end $$;

-- a project row is its own project_id
create or replace function hb_project_self() returns trigger language plpgsql as $$
begin new.project_id := new.id; return new; end $$;
drop trigger if exists hb_projects_self on hb_projects;
create trigger hb_projects_self before insert or update on hb_projects for each row execute function hb_project_self();
