"use client";
import { supabase } from "./supabase/client";
import { aggregate, type AggMap } from "./behavior";
import { computeRow, type Entries, type GradeRow } from "./grades";
import type { Settings } from "./settings";
import type { Assignment, GradeEntry, Session, SessionRecord, Student, Subject, Submission } from "./types";

export type SubjectGrades = {
  entries: Record<string, Entries>; // student_id → entries
  agg: AggMap;
  rows: Record<string, GradeRow>; // student_id → computed row
};

export async function loadSubjectGrades(subjectId: string, students: Student[], s: Settings): Promise<SubjectGrades> {
  const sb = supabase();
  const [ge, ses, asg] = await Promise.all([
    sb.from("grade_entries").select("*").eq("subject_id", subjectId),
    sb.from("sessions").select("*").eq("subject_id", subjectId).is("deleted_at", null),
    sb.from("assignments").select("*").eq("subject_id", subjectId).is("deleted_at", null),
  ]);
  const sessions = (ses.data ?? []) as Session[];
  const assignments = (asg.data ?? []) as Assignment[];
  let records: SessionRecord[] = [];
  let subs: Submission[] = [];
  if (s.grading.progress_mode === "behavior") {
    const ids = sessions.map((x) => x.id);
    const aids = assignments.map((x) => x.id);
    if (ids.length) records = ((await sb.from("session_records").select("*").in("session_id", ids)).data ?? []) as SessionRecord[];
    if (aids.length) subs = ((await sb.from("assignment_submissions").select("*").in("assignment_id", aids)).data ?? []) as Submission[];
  }
  const entries: Record<string, Entries> = {};
  for (const g of (ge.data ?? []) as GradeEntry[]) {
    (entries[g.student_id] ??= {})[g.component] = { score: g.score === null ? null : Number(g.score), excused: g.excused };
  }
  const agg = aggregate(sessions, records, assignments, subs);
  const rows: Record<string, GradeRow> = {};
  for (const st of students) rows[st.id] = computeRow(entries[st.id] ?? {}, s, agg[st.id]);
  return { entries, agg, rows };
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
