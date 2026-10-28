"use client";
import { supabase } from "./supabase/client";
import { fetchAll } from "./class-data";
import { overlay } from "./outbox";
import type { AlertData } from "./alerts";
import type { AlertState, Assignment, ClassRow, GradeEntry, Session, SessionRecord, Slot, Student, Subject, Submission } from "./types";

/** كل ما تحتاجه التنبيهات، في طلبات قليلة لكل الصفوف (غير المؤرشفة). */
export async function loadAlertData(weights: AlertData["weights"]): Promise<{ data: AlertData; states: AlertState[] }> {
  const sb = supabase();
  const [cl, st, sj, sl, ad, as] = await Promise.all([
    sb.from("classes").select("*").is("deleted_at", null).eq("archived", false),
    sb.from("students").select("*").is("deleted_at", null).eq("active", true),
    sb.from("subjects").select("*").is("deleted_at", null),
    sb.from("schedule_slots").select("*"),
    sb.from("assessment_dates").select("subject_id,component,date"),
    sb.from("alert_states").select("key,status,fingerprint,snoozed_until"),
  ]);
  const [sessions, records, grades, assignments, submissions] = await Promise.all([
    fetchAll((f, t) => sb.from("sessions").select("id,subject_id,schedule_slot_id,date,semester,cancelled,locked,deleted_at,topic").range(f, t)),
    fetchAll((f, t) => sb.from("session_records").select("session_id,student_id,participation,disruption,late,absence,homework").range(f, t)),
    fetchAll((f, t) => sb.from("grade_entries").select("subject_id,student_id,component,score,excused").range(f, t)),
    fetchAll((f, t) => sb.from("assignments").select("id,subject_id,title,due_date,semester,max_score,deleted_at").is("deleted_at", null).range(f, t)),
    fetchAll((f, t) => sb.from("assignment_submissions").select("assignment_id,student_id,status,score").range(f, t)),
  ]);
  return {
    data: {
      classes: (cl.data ?? []) as ClassRow[],
      students: (st.data ?? []) as Student[],
      subjects: (sj.data ?? []) as Subject[],
      slots: (sl.data ?? []) as Slot[],
      sessions: overlay("sessions", sessions as Session[]),
      records: overlay("session_records", records as SessionRecord[]),
      grades: overlay("grade_entries", grades as GradeEntry[]),
      assignments: assignments as Assignment[],
      submissions: overlay("assignment_submissions", submissions as Submission[]),
      dates: (ad.data ?? []) as AlertData["dates"],
      weights,
    },
    states: (as.data ?? []) as AlertState[],
  };
}
