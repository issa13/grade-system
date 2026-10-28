-- =====================================================================
-- نظام إدارة العلامات — الإصدار 2
-- شغّل هذا الملف مرة واحدة من: Supabase → SQL Editor → New query → Run
-- (بعد schema.sql). لا يمس البيانات الموجودة، وآمن لإعادة التشغيل.
-- =====================================================================

-- ---------- 4) رقم الطالب ----------
alter table public.students add column if not exists phone text;          -- رقم الطالب بالصيغة الدولية (مثلاً 9613123456)
alter table public.students add column if not exists pending_phone text;  -- رقم أرسله الطالب من صفحته، بانتظار موافقة الأستاذ

-- الطالب يرسل رقمه من صفحته الخاصة (بدون حساب). يُحفظ «بانتظار الموافقة» فقط.
create or replace function public.submit_phone(p_token uuid, p_phone text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  ph text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(ph) < 8 or length(ph) > 15 then return false; end if;
  update public.students set pending_phone = ph
   where share_token = p_token and share_enabled and active and deleted_at is null
     and coalesce(phone, '') <> ph;
  return found;
end $$;
revoke all on function public.submit_phone(uuid, text) from public;
grant execute on function public.submit_phone(uuid, text) to anon, authenticated;

-- ---------- 7) تواريخ الامتحانات ----------
create table if not exists public.assessment_dates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  component text not null check (component in ('p1','p2','m1','p3','p4','m2')),
  date date not null,
  updated_at timestamptz not null default now(),
  unique (subject_id, component)
);
create index if not exists idx_adates_subject on public.assessment_dates(subject_id);

-- ---------- 6) حالة التنبيهات (تمّ / ذكّرني لاحقاً) ----------
create table if not exists public.alert_states (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,                                 -- مفتاح التنبيه (القاعدة + الطالب + المادة…)
  status text not null check (status in ('done','snoozed')),
  fingerprint text,                                  -- «تمّ» يبقى مخفياً حتى تتغير الحالة (مثلاً غياب جديد)
  snoozed_until date,
  updated_at timestamptz not null default now(),
  primary key (owner_id, key)
);

-- ---------- 4) سجل رسائل واتساب ----------
create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  sent_at timestamptz not null default now(),
  period_from date,
  period_to date
);
create index if not exists idx_msglog_student on public.message_log(student_id, sent_at desc);

-- RLS + سجل التعديلات للجداول الجديدة (مثل باقي الجداول)
do $$
declare t text;
begin
  foreach t in array array['assessment_dates','alert_states','message_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists owner_all on public.%I', t);
    execute format('create policy owner_all on public.%I for all to authenticated
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------- 10) منع توقف Supabase ----------
-- سطر واحد فيه وقت آخر نبضة. الدالة متاحة للمفتاح العام ولا تقرأ أو تعيد أي بيانات.
create table if not exists public.keepalive (
  id int primary key default 1 check (id = 1),
  beat_at timestamptz not null default now()
);
alter table public.keepalive enable row level security;
drop policy if exists read_beat on public.keepalive;
create policy read_beat on public.keepalive for select to authenticated using (true);

create or replace function public.keepalive() returns void
language sql security definer set search_path = public as $$
  insert into public.keepalive(id, beat_at) values (1, now())
  on conflict (id) do update set beat_at = excluded.beat_at;
$$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;

-- ---------- 2) العمل بدون إنترنت: حماية من الكتابة القديمة ----------
-- كل تعديل يحمل وقت الضغطة (updated_at). إذا وصل تعديل أقدم من المحفوظ (مثلاً تلفون بقي
-- بدون إنترنت بينما عدّلت من الكمبيوتر) يُرفض بصمت، والتطبيق يعرضه في «تعديلات لم تُطبّق».
create or replace function public.reject_stale_write() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- لا تعديل
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['session_records','grade_entries','assignment_submissions']
  loop
    execute format('drop trigger if exists trg_stale on public.%I', t);
    execute format('create trigger trg_stale before update on public.%I
                    for each row execute function public.reject_stale_write()', t);
  end loop;
end $$;

-- حصة واحدة فقط لكل موعد في كل تاريخ (يُتخطّى بهدوء إذا كانت هناك حصص مكررة قديمة).
do $$
begin
  create unique index if not exists uq_sessions_slot_date on public.sessions(schedule_slot_id, date)
    where deleted_at is null and schedule_slot_id is not null;
exception when others then
  raise notice 'uq_sessions_slot_date: توجد حصص مكررة سابقاً، لم يُنشأ الفهرس';
end $$;
create index if not exists idx_sessions_date on public.sessions(date);

-- ---------- تقرير الطالب: بدون التوقيع والملاحظات الخاصة، مع حالة الرقم ----------
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
                                  'class_name', st.class_name, 'school_year', st.school_year,
                                  'phone_set', st.phone is not null,
                                  'phone_pending', st.pending_phone is not null),
    -- التوقيع لا يظهر أبداً في صفحة الطالب، وملاحظات التقرير خاصة بالأستاذ
    'settings', coalesce((select jsonb_object_agg(key,
                            case when key = 'report_images' then value - 'signature' else value end)
                           from public.settings
                          where owner_id = st.owner_id
                            and key not like 'report_notes:%'), '{}'::jsonb),
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
