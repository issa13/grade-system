-- =====================================================================
-- نظام إدارة علامات الطلاب — مخطط قاعدة البيانات (Supabase / Postgres)
-- شغّل هذا الملف مرة واحدة من: Supabase → SQL Editor → New query → Run
-- آمن لإعادة التشغيل (يستعمل IF NOT EXISTS / OR REPLACE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- الجداول ----------

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  school_year text,
  notes text,
  archived boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  full_name text not null,
  student_number text,
  notes text,
  share_token uuid not null default gen_random_uuid() unique,
  share_enabled boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  name text not null,
  color text not null default '#1f7a68',
  weight numeric not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6), -- 0 = الأحد
  start_time time,
  end_time time,
  created_at timestamptz not null default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  schedule_slot_id uuid references public.schedule_slots(id) on delete set null,
  date date not null,
  semester int not null default 1 check (semester in (1,2)),
  topic text,
  cancelled boolean not null default false,
  locked boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.session_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  participation int not null default 0,
  disruption int not null default 0,
  late boolean not null default false,
  absence text check (absence in ('excused','unexcused')),
  homework text check (homework in ('done','missing')),
  note text,
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  due_date date,
  semester int not null default 1 check (semester in (1,2)),
  max_score numeric,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  status text check (status in ('done','missing','late')),
  score numeric,
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

-- علامات كشف العلامات (نفس أعمدة ملف الإكسل)
-- p1,p2 = الفتري 1،2 | m1 = الفصل 1 | pr1 = السعي 1
-- p3,p4 = الفتري 3،4 | m2 = الفصل 2 | pr2 = السعي 2
create table if not exists public.grade_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  component text not null check (component in ('p1','p2','m1','pr1','p3','p4','m2','pr2')),
  score numeric,
  excused boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (subject_id, student_id, component)
);

create table if not exists public.settings (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

create table if not exists public.audit_log (
  id bigserial primary key,
  owner_id uuid not null,
  table_name text not null,
  row_id text,
  action text not null,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- ---------- الفهارس ----------
create index if not exists idx_students_class on public.students(class_id);
create index if not exists idx_subjects_class on public.subjects(class_id);
create index if not exists idx_slots_subject on public.schedule_slots(subject_id);
create index if not exists idx_sessions_subject on public.sessions(subject_id, date);
create index if not exists idx_records_session on public.session_records(session_id);
create index if not exists idx_records_student on public.session_records(student_id);
create index if not exists idx_grades_subject on public.grade_entries(subject_id);
create index if not exists idx_grades_student on public.grade_entries(student_id);
create index if not exists idx_assign_subject on public.assignments(subject_id);
create index if not exists idx_sub_assign on public.assignment_submissions(assignment_id);
create index if not exists idx_audit_owner on public.audit_log(owner_id, at desc);

-- ---------- أمان على مستوى الصفوف (RLS) ----------
do $$
declare t text;
begin
  foreach t in array array['classes','students','subjects','schedule_slots','sessions',
    'session_records','assignments','assignment_submissions','grade_entries','settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

alter table public.audit_log enable row level security;
drop policy if exists owner_read on public.audit_log;
create policy owner_read on public.audit_log for select to authenticated using (owner_id = auth.uid());

-- ---------- سجل التدقيق (Audit) ----------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o uuid;
  rid text;
begin
  if tg_op = 'DELETE' then
    o := old.owner_id; rid := to_jsonb(old)->>'id';
  else
    o := new.owner_id; rid := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key');
  end if;
  insert into public.audit_log(owner_id, table_name, row_id, action, before, after)
  values (o, tg_table_name, rid, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['classes','students','subjects','schedule_slots','sessions',
    'session_records','assignments','assignment_submissions','grade_entries','settings']
  loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------- تحديث مباشر لصفحة الطالب (Realtime broadcast) ----------
create or replace function public.notify_student_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
  tok uuid;
begin
  sid := coalesce(to_jsonb(new)->>'student_id', to_jsonb(old)->>'student_id')::uuid;
  select share_token into tok from public.students where id = sid;
  if tok is not null then
    begin
      perform realtime.send(jsonb_build_object('at', now()), 'changed', 'report:' || tok::text, false);
    exception when others then null; -- لا نوقف الحفظ إذا لم يكن Realtime مفعلاً
    end;
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['grade_entries','session_records','assignment_submissions']
  loop
    execute format('drop trigger if exists trg_notify on public.%I', t);
    execute format('create trigger trg_notify after insert or update or delete on public.%I
                    for each row execute function public.notify_student_report()', t);
  end loop;
end $$;

-- ---------- تقرير الطالب عبر الرابط الخاص (بدون حساب) ----------
create or replace function public.get_student_report(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st record;
  vis jsonb;
  comps text[];
  result jsonb;
begin
  select s.*, c.name as class_name, c.school_year
    into st
    from public.students s join public.classes c on c.id = s.class_id
   where s.share_token = p_token and s.share_enabled and s.active
     and s.deleted_at is null and c.deleted_at is null;
  if not found then return null; end if;

  select value into vis from public.settings where owner_id = st.owner_id and key = 'visibility';
  comps := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(vis->'components') x),
    array['p1','p2','m1','pr1','p3','p4','m2','pr2']);

  select jsonb_build_object(
    'student', jsonb_build_object('name', st.full_name, 'number', st.student_number,
                                  'class_name', st.class_name, 'school_year', st.school_year),
    'settings', coalesce((select jsonb_object_agg(key, value) from public.settings
                           where owner_id = st.owner_id), '{}'::jsonb),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object(
        'id', sb.id, 'name', sb.name, 'color', sb.color, 'weight', sb.weight) order by sb.created_at)
        from public.subjects sb where sb.class_id = st.class_id and sb.deleted_at is null), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
        'subject_id', g.subject_id, 'component', g.component, 'score', g.score, 'excused', g.excused))
        from public.grade_entries g
        join public.subjects sb on sb.id = g.subject_id and sb.deleted_at is null
        where g.student_id = st.id and g.component = any(comps)), '[]'::jsonb),
    'behavior', coalesce((select jsonb_agg(row_to_json(b)) from (
        select se.subject_id, se.semester,
               count(*) filter (where r.id is not null) as sessions,
               coalesce(sum(r.participation),0) as participation,
               coalesce(sum(r.disruption),0) as disruption,
               count(*) filter (where r.late) as late,
               count(*) filter (where r.absence = 'excused') as absent_excused,
               count(*) filter (where r.absence = 'unexcused') as absent_unexcused,
               count(*) filter (where r.homework = 'done') as hw_done,
               count(*) filter (where r.homework = 'missing') as hw_missing
          from public.sessions se
          join public.session_records r on r.session_id = se.id and r.student_id = st.id
         where se.deleted_at is null and not se.cancelled
         group by se.subject_id, se.semester) b), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(row_to_json(a)) from (
        select asg.subject_id, asg.semester,
               count(*) filter (where su.status = 'done') as done,
               count(*) filter (where su.status = 'late') as late,
               count(*) filter (where su.status = 'missing') as missing
          from public.assignments asg
          join public.assignment_submissions su on su.assignment_id = asg.id and su.student_id = st.id
         where asg.deleted_at is null
         group by asg.subject_id, asg.semester) a), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke all on function public.get_student_report(uuid) from public;
grant execute on function public.get_student_report(uuid) to anon, authenticated;
