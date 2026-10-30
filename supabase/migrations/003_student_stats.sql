-- =====================================================================
-- نظام إدارة العلامات — التحديث 3: إحصائيات في رابط الطالب + حماية البيانات
-- شغّل هذا الملف مرة واحدة من: Supabase → SQL Editor → New query → Run
-- (بعد schema.sql و 002_v2.sql). لا يمس البيانات الموجودة، وآمن لإعادة التشغيل.
-- =====================================================================

-- ---------- رقم نسخة قاعدة البيانات ----------
-- الموقع يتحقق منه ويُظهر تنبيهاً إذا نسيت تشغيل ملف تحديث.
create or replace function public.app_schema_version() returns int
language sql immutable as $$ select 3 $$;
grant execute on function public.app_schema_version() to anon, authenticated;

-- ---------- التحقق من البيانات على مستوى قاعدة البيانات ----------
-- NOT VALID: تُطبَّق على كل كتابة جديدة فقط، ولا تفحص (ولا ترفض) البيانات القديمة.
do $$
begin
  begin alter table public.grade_entries add constraint chk_grade_score check (score is null or (score >= 0 and score <= 1000)) not valid; exception when duplicate_object then null; end;
  begin alter table public.session_records add constraint chk_rec_counts check (participation >= 0 and participation <= 100 and disruption >= 0 and disruption <= 100) not valid; exception when duplicate_object then null; end;
  begin alter table public.session_records add constraint chk_rec_note check (note is null or length(note) <= 1000) not valid; exception when duplicate_object then null; end;
  begin alter table public.students add constraint chk_student_name check (length(btrim(full_name)) between 1 and 200) not valid; exception when duplicate_object then null; end;
  begin alter table public.students add constraint chk_student_phone check (phone is null or phone ~ '^[0-9]{8,15}$') not valid; exception when duplicate_object then null; end;
  begin alter table public.students add constraint chk_student_pending check (pending_phone is null or pending_phone ~ '^[0-9]{8,15}$') not valid; exception when duplicate_object then null; end;
  begin alter table public.classes add constraint chk_class_name check (length(btrim(name)) between 1 and 200) not valid; exception when duplicate_object then null; end;
  begin alter table public.subjects add constraint chk_subject_name check (length(btrim(name)) between 1 and 200) not valid; exception when duplicate_object then null; end;
  begin alter table public.subjects add constraint chk_subject_weight check (weight > 0 and weight <= 100) not valid; exception when duplicate_object then null; end;
  begin alter table public.schedule_slots add constraint chk_slot_time check (start_time is null or end_time is null or end_time > start_time) not valid; exception when duplicate_object then null; end;
  begin alter table public.assignments add constraint chk_assign_max check (max_score is null or max_score > 0) not valid; exception when duplicate_object then null; end;
  begin alter table public.assignment_submissions add constraint chk_sub_score check (score is null or score >= 0) not valid; exception when duplicate_object then null; end;
  begin alter table public.settings add constraint chk_settings_size check (pg_column_size(value) <= 600000) not valid; exception when duplicate_object then null; end;
end $$;

-- فهارس تسرّع صفحات الإحصائيات والتنبيهات
create index if not exists idx_records_student_session on public.session_records(student_id, session_id);
create index if not exists idx_grades_updated on public.grade_entries(updated_at);
create index if not exists idx_students_token on public.students(share_token);

-- ---------- تقرير الطالب (رابطه الخاص) مع الإحصائيات ----------
-- يعيد بيانات هذا الطالب فقط. «زملاء الصف» (علامات بدون أسماء ولا معرّفات، بترتيب عشوائي)
-- تُرسل فقط إذا فعّل الأستاذ «الترتيب» أو «معدل الصف» في الإعدادات ← ما يراه الطالب،
-- حتى يُحسب الترتيب ومعدل الصف بنفس معادلات الموقع.
create or replace function public.get_student_report(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  st record;
  vis jsonb;
  comps text[];
  peers boolean;
  result jsonb;
begin
  if p_token is null then return null; end if;
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
  peers := coalesce((vis->>'show_class_rank')::boolean, false) or coalesce((vis->>'show_class_avg')::boolean, false);

  select jsonb_build_object(
    'version', 3,
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
         group by asg.subject_id, asg.semester) a), '[]'::jsonb),
    -- تسجيلات هذا الطالب حصةً حصة (للحضور في كل نصف، والرسم بالأسابيع)
    'records', coalesce((select jsonb_agg(jsonb_build_object(
        'session_id', se.id, 'date', se.date, 'subject_id', se.subject_id, 'semester', se.semester,
        'participation', r.participation, 'disruption', r.disruption, 'late', r.late,
        'absence', r.absence, 'homework', r.homework) order by se.date)
        from public.session_records r
        join public.sessions se on se.id = r.session_id and se.deleted_at is null and not se.cancelled
        join public.subjects sb on sb.id = se.subject_id and sb.deleted_at is null
        where r.student_id = st.id), '[]'::jsonb),
    -- تواريخ الامتحانات (للمسار) — للعلامات الظاهرة فقط
    'dates', coalesce((select jsonb_agg(jsonb_build_object('subject_id', d.subject_id, 'component', d.component, 'date', d.date))
        from public.assessment_dates d
        join public.subjects sb on sb.id = d.subject_id and sb.class_id = st.class_id and sb.deleted_at is null
        where d.component = any(comps)), '[]'::jsonb),
    'classmates', case when not peers then '[]'::jsonb else coalesce((select jsonb_agg(m.v order by m.k) from (
        select gen_random_uuid() as k, jsonb_build_object(
          'entries', coalesce((select jsonb_agg(jsonb_build_object('subject_id', g.subject_id, 'component', g.component, 'score', g.score, 'excused', g.excused))
              from public.grade_entries g join public.subjects sb on sb.id = g.subject_id and sb.deleted_at is null
              where g.student_id = o.id and g.component = any(comps)), '[]'::jsonb),
          'behavior', coalesce((select jsonb_agg(row_to_json(b)) from (
              select se.subject_id, se.semester, count(*) as sessions,
                     coalesce(sum(r.participation),0) as participation, coalesce(sum(r.disruption),0) as disruption,
                     count(*) filter (where r.late) as late,
                     count(*) filter (where r.absence = 'excused') as absent_excused,
                     count(*) filter (where r.absence = 'unexcused') as absent_unexcused,
                     count(*) filter (where r.homework = 'done') as hw_done,
                     count(*) filter (where r.homework = 'missing') as hw_missing
                from public.sessions se join public.session_records r on r.session_id = se.id and r.student_id = o.id
               where se.deleted_at is null and not se.cancelled
               group by se.subject_id, se.semester) b), '[]'::jsonb),
          'assignments', coalesce((select jsonb_agg(row_to_json(a)) from (
              select asg.subject_id, asg.semester,
                     count(*) filter (where su.status = 'done') as done,
                     count(*) filter (where su.status = 'late') as late,
                     count(*) filter (where su.status = 'missing') as missing
                from public.assignments asg join public.assignment_submissions su on su.assignment_id = asg.id and su.student_id = o.id
               where asg.deleted_at is null
               group by asg.subject_id, asg.semester) a), '[]'::jsonb)
        ) as v
        from public.students o
        where o.class_id = st.class_id and o.id <> st.id and o.active and o.deleted_at is null
      ) m), '[]'::jsonb) end
  ) into result;
  return result;
end $$;

revoke all on function public.get_student_report(uuid) from public;
grant execute on function public.get_student_report(uuid) to anon, authenticated;
