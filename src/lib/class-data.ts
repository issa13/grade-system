"use client";
import { supabase } from "./supabase/client";
import { overlay } from "./outbox";
import { aggregate, type AggMap } from "./behavior";
import { computeRow, type Entries, type GradeRow } from "./grades";
import { effectiveSettings, type Settings, type SubjectWeights } from "./settings";
import type { Assignment, GradeEntry, Session, SessionRecord, Student, Subject, Submission } from "./types";

/** جلب كل الصفوف على دفعات (Supabase يعيد 1000 صف كحد أقصى في الطلب الواحد). */
export async function fetchAll<T = unknown>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await q(from, from + 999);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export type SubjectGrades = {
  entries: Record<string, Entries>; // student_id → entries
  agg: AggMap;
  rows: Record<string, GradeRow>; // student_id → computed row
  sessions?: Session[];
  records?: SessionRecord[];
  assignments?: Assignment[];
  submissions?: Submission[];
};

export async function loadSubjectGrades(subjectId: string, students: Student[], s: Settings, weights?: SubjectWeights | null): Promise<SubjectGrades> {
  const eff = effectiveSettings(s, weights);
  const sb = supabase();
  const [ge, ses, asg] = await Promise.all([
    fetchAll((f, t) => sb.from("grade_entries").select("*").eq("subject_id", subjectId).range(f, t)),
    sb.from("sessions").select("*").eq("subject_id", subjectId).is("deleted_at", null),
    sb.from("assignments").select("*").eq("subject_id", subjectId).is("deleted_at", null),
  ]);
  const sessions = overlay("sessions", (ses.data ?? []) as Session[], (r) => r.subject_id === subjectId).filter((x) => !x.deleted_at);
  const assignments = (asg.data ?? []) as Assignment[];
  // سجلات الحصص والوظائف (للسعي المحسوب وللإحصائيات)
  const [recRows, subRows] = await Promise.all([
    fetchAll((from, to) => sb.from("session_records").select("*, sessions!inner(subject_id)").eq("sessions.subject_id", subjectId).range(from, to)),
    fetchAll((from, to) => sb.from("assignment_submissions").select("*, assignments!inner(subject_id)").eq("assignments.subject_id", subjectId).range(from, to)),
  ]);
  // التعديلات غير المرسلة بعد (بدون إنترنت) تظهر فوق المحفوظ
  const sesIds = new Set(sessions.map((x) => x.id));
  const asgIds = new Set(assignments.map((x) => x.id));
  const records = overlay("session_records", recRows as SessionRecord[], (r) => sesIds.has(String(r.session_id)));
  const subs = overlay("assignment_submissions", subRows as Submission[], (r) => asgIds.has(String(r.assignment_id)));
  const entries: Record<string, Entries> = {};
  for (const g of overlay("grade_entries", ge as GradeEntry[], (r) => r.subject_id === subjectId)) {
    (entries[g.student_id] ??= {})[g.component] = { score: g.score === null ? null : Number(g.score), excused: g.excused };
  }
  const agg = aggregate(sessions, records, assignments, subs);
  const rows: Record<string, GradeRow> = {};
  for (const st of students) rows[st.id] = computeRow(entries[st.id] ?? {}, eff, agg[st.id]);
  return { entries, agg, rows, sessions, records, assignments, submissions: subs };
}

/** كل بيانات صف: الطلاب والمواد وعلامات/حضور كل مادة. */
export async function loadClassFull(classId: string, s: Settings, weights: Record<string, SubjectWeights>) {
  const basics = await loadClassBasics(classId);
  const students = basics.students.filter((x) => x.active);
  const data: Record<string, SubjectGrades> = {};
  await Promise.all(basics.subjects.map(async (sj) => { data[sj.id] = await loadSubjectGrades(sj.id, students, s, weights[sj.id]); }));
  return { ...basics, students, data };
}

export async function loadClassBasics(classId: string) {
  const sb = supabase();
  const [c, st, sj] = await Promise.all([
    sb.from("classes").select("*").eq("id", classId).single(),
    sb.from("students").select("*").eq("class_id", classId).is("deleted_at", null).order("sort_order").order("full_name"),
    sb.from("subjects").select("*").eq("class_id", classId).is("deleted_at", null).order("created_at"),
  ]);
  return {
    cls: c.data as import("./types").ClassRow | null,
    students: (st.data ?? []) as Student[],
    subjects: (sj.data ?? []) as Subject[],
  };
}
