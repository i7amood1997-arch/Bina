-- Run AFTER both of you have signed in to the app once (so your accounts exist in auth.users).
-- Replace the two emails and names, then run in Supabase → SQL Editor.

with p as (
  insert into hb_projects (id, name, plot_no, location, contingency_pct)
  values (gen_random_uuid(), 'بيت جبلة حبشي', '04030658', 'جبلة حبشي', 10)
  returning id
),
m as (
  insert into hb_project_members (project_id, user_id, display_name)
  select p.id, u.id, x.display_name
  from p
  join (values ('AHMED_EMAIL@example.com', 'أحمد'),
               ('FATHER_EMAIL@example.com', 'الوالد')) as x(email, display_name) on true
  join auth.users u on lower(u.email) = lower(x.email)
  returning project_id, user_id, display_name
)
insert into hb_payers (project_id, name, user_id)
select project_id, display_name, user_id from m;

-- Check:
-- select * from hb_project_members;
-- select * from hb_payers;
