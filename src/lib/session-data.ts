"use client";
// تحميل بيانات الحصص (تُستعمل في صفحة التسجيل وفي البرنامج الأسبوعي).
// نفس الطلبات تُستعمل للتحميل المسبق حتى تعمل حصص الأسبوع بدون إنترنت.
import { supabase } from "./supabase/client";
import { fetchAll, must } from "./class-data";
import { enqueue, overlay, pendingRows } from "./outbox";
import { summarize, type RecSummary, type SubjectInfo } from "./schedule";
import type { ClassRow, Session, SessionRecord, Slot, Student, Subject } from "./types";

export type SessionBundle = {
  session: Session;
  subject: Subject | null;
  cls: ClassRow | null;
  students: Student[];
  records: SessionRecord[];
  siblings: { prev?: string; next?: string };
};

const SESSION_DEFAULTS = { topic: null, cancelled: false, locked: false, deleted_at: null, schedule_slot_id: null };

/** بيانات صفحة تسجيل حصة. تعمل بدون إنترنت إذا فُتحت سابقاً على هذا الجهاز. */
export async function loadSessionBundle(id: string): Promise<SessionBundle | null> {
  const sb = supabase();
  const { data: s0, error: e0 } = await sb.from("sessions").select("*").eq("id", id).maybeSingle();
  const pend = pendingRows("sessions", (r) => r.id === id)[0];
  if (e0 && !pend) throw new Error(e0.message);
  const session = (pend ? { ...SESSION_DEFAULTS, ...(s0 ?? {}), ...pend } : s0) as Session | null;
  if (!session) return null;
  const subj = await loadSubjectBits(session.subject_id);
  const rec = await sb.from("session_records").select("*").eq("session_id", id);
  // حصة موجودة ولم نستطع قراءة تسجيلاتها: لا نعرض قائمة فارغة (حتى لا يُكتب فوق التسجيل الحقيقي)
  if (rec.error && (s0 || !pend)) throw new Error(rec.error.message);
  const records = overlay("session_records", (rec.data ?? []) as SessionRecord[], (r) => r.session_id === id);
  const list = [...subj.siblings];
  if (!list.some((x) => x.id === id) && !session.cancelled) list.push({ id, date: session.date });
  list.sort((a, b) => a.date.localeCompare(b.date));
  const i = list.findIndex((x) => x.id === id);
  return { session, subject: subj.subject, cls: subj.cls, students: subj.students, records, siblings: { prev: list[i - 1]?.id, next: list[i + 1]?.id } };
}

async function loadSubjectBits(subjectId: string) {
  const sb = supabase();
  const sjr = await sb.from("subjects").select("*").eq("id", subjectId).maybeSingle();
  const subject = (must(sjr) as Subject) ?? null;
  if (!subject) return { subject: null, cls: null, students: [] as Student[], siblings: [] as { id: string; date: string }[] };
  const [c, st, sib] = await Promise.all([
    sb.from("classes").select("*").eq("id", subject.class_id).maybeSingle(),
    sb.from("students").select("*").eq("class_id", subject.class_id).is("deleted_at", null).eq("active", true).order("sort_order").order("full_name"),
    sb.from("sessions").select("id,date").eq("subject_id", subjectId).is("deleted_at", null).eq("cancelled", false).order("date"),
  ]);
  const pendSessions = pendingRows("sessions", (r) => r.subject_id === subjectId && !r.cancelled && !!r.date)
    .map((r) => ({ id: String(r.id), date: String(r.date) }));
  must(c); must(st);
  const siblings = [...((sib.data ?? []) as { id: string; date: string }[])];
  for (const p of pendSessions) if (!siblings.some((x) => x.id === p.id)) siblings.push(p);
  return { subject, cls: (c.data as ClassRow) ?? null, students: (st.data ?? []) as Student[], siblings };
}

/** تحميل مسبق (في الخلفية) لحصص الأسبوع حتى تفتح بدون إنترنت. */
export async function prefetchSessions(ids: string[], subjectIds: string[]) {
  const subjects = [...new Set(subjectIds)];
  for (const s of subjects) { try { await loadSubjectBits(s); } catch {} }
  for (const id of [...new Set(ids)]) { try { await loadSessionBundle(id); } catch {} }
}

/** إنشاء الحصة (إذا لم تكن موجودة) لموعد وتاريخ معيّنين. يعمل بدون إنترنت، وبدون تكرار. */
export function ensureSession(p: { id: string; subject_id: string; schedule_slot_id: string | null; date: string; semester: 1 | 2 }) {
  enqueue("sessions", { id: p.id, subject_id: p.subject_id, schedule_slot_id: p.schedule_slot_id, date: p.date, semester: p.semester });
}

// ---------------- البرنامج الأسبوعي ----------------
type SubjRow = { id: string; name: string; color: string; class_id: string; classes: { id: string; name: string } };
const info = (s: SubjRow): SubjectInfo => ({ id: s.id, name: s.name, color: s.color, class_id: s.class_id, class_name: s.classes?.name ?? "" });
const SUBJ = "subjects!inner(id,name,color,class_id,deleted_at,classes!inner(id,name,archived,deleted_at))";

/** ثلاثة طلبات لأسبوع واحد: مواعيد البرنامج، الحصص، والتسجيلات. */
export async function loadWeek(from: string, to: string) {
  const sb = supabase();
  const [sl, se, recs] = await Promise.all([
    sb.from("schedule_slots").select(`*, ${SUBJ}`).is("subjects.deleted_at", null).is("subjects.classes.deleted_at", null).eq("subjects.classes.archived", false),
    sb.from("sessions").select(`*, ${SUBJ}`).gte("date", from).lte("date", to).is("subjects.deleted_at", null).is("subjects.classes.deleted_at", null).eq("subjects.classes.archived", false),
    fetchAll((f, t) => sb.from("session_records").select("session_id,student_id,participation,disruption,late,absence,homework,note,sessions!inner(date)")
      .gte("sessions.date", from).lte("sessions.date", to).range(f, t)),
  ]);
  must(sl); must(se);
  const slots = ((sl.data ?? []) as (Slot & { subjects: SubjRow })[]).map(({ subjects, ...s }) => ({ ...s, subject: info(subjects) }));
  const subjById = new Map(slots.map((s) => [s.subject.id, s.subject]));
  let sessions: (Session & { subject: SubjectInfo })[] = ((se.data ?? []) as (Session & { subjects: SubjRow })[]).map(({ subjects, ...s }) => {
    const i = info(subjects);
    subjById.set(i.id, i);
    return { ...s, subject: i };
  });
  // حصص أُنشئت على هذا الجهاز ولم تُرسل بعد
  const pend = pendingRows("sessions", (r) => !r.date || (String(r.date) >= from && String(r.date) <= to));
  for (const p of pend) {
    const cur = sessions.find((x) => x.id === p.id);
    if (cur) Object.assign(cur, p);
    else if (p.subject_id && subjById.has(String(p.subject_id))) {
      sessions.push({ ...SESSION_DEFAULTS, ...(p as unknown as Session), subject: subjById.get(String(p.subject_id))! } as Session & { subject: SubjectInfo });
    }
  }
  sessions = sessions.filter((s) => s.date >= from && s.date <= to);
  const ids = new Set(sessions.map((s) => s.id));
  const allRecs = overlay("session_records", recs as SessionRecord[]).filter((r) => ids.has(r.session_id) || !r.session_id);
  const bySession: Record<string, SessionRecord[]> = {};
  for (const r of allRecs) (bySession[r.session_id] ??= []).push(r);
  const summaries: Record<string, RecSummary> = {};
  for (const [k, v] of Object.entries(bySession)) summaries[k] = summarize(v);
  return { slots, sessions, records: allRecs, summaries };
}
