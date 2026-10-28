// البرنامج الأسبوعي: بناء جدول الأسبوع من مواعيد المواد والحصص والتسجيلات.
// دوال صافية (بدون قاعدة بيانات) حتى يسهل اختبارها.
import { semesterFor, toISO } from "./dates";
import { sessionIdFor } from "./ids";
import type { Settings } from "./settings";
import type { Session, Slot } from "./types";

export type SubjectInfo = { id: string; name: string; color: string; class_id: string; class_name: string };
export type RecSummary = { records: number; absent: number; excused: number; late: number; participation: number; disruption: number; hwDone: number; hwMissing: number };
export type Status = "logged" | "locked" | "cancelled" | "now" | "missed" | "today" | "upcoming";

export type Instance = {
  id: string; // معرّف الحصة (حقيقي، أو المعرّف الثابت لحصة لم تُنشأ بعد)
  real: boolean;
  session: Session | null;
  slot: Slot | null;
  subject: SubjectInfo;
  date: string;
  start: string | null; // "08:00"
  end: string | null;
  semester: 1 | 2;
  status: Status;
  current: boolean; // داخل نافذة «الآن»
  next: boolean; // الحصة التالية اليوم
  summary: RecSummary | null;
};

export type Day = { date: string; weekday: number; holiday: string | null; isToday: boolean };
export type Row = { key: string; start: string | null; end: string | null };

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
export const minutes = (t: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

function parse(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(iso: string, n: number) {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** أول يوم دوام في الأسبوع: اليوم الذي يلي العطلة الأسبوعية (أو الإثنين إذا لا توجد عطلة). */
export function firstWorkday(weekend: number[]): number {
  if (!weekend.length || weekend.length >= 7) return 1;
  for (let d = 0; d < 7; d++) if (!weekend.includes(d) && weekend.includes((d + 6) % 7)) return d;
  return 1;
}

/** بداية الأسبوع الذي فيه التاريخ. في يوم العطلة نعرض الأسبوع القادم. */
export function weekStartFor(iso: string, weekend: number[]): string {
  let cur = iso;
  if (weekend.length < 7) for (let i = 0; i < 7 && weekend.includes(parse(cur).getDay()); i++) cur = addDays(cur, 1);
  const s = firstWorkday(weekend);
  const back = (parse(cur).getDay() - s + 7) % 7;
  return addDays(cur, -back);
}

/** أيام الدوام في الأسبوع (بدون العطلة الأسبوعية)، مع اسم العطلة الرسمية إن وُجدت. */
export function weekDays(start: string, s: Settings, todayISO: string): Day[] {
  const out: Day[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const wd = parse(date).getDay();
    if (s.year.weekend_days.includes(wd)) continue;
    const br = s.year.breaks.find((b) => b.from && b.to && date >= b.from && date <= b.to);
    out.push({ date, weekday: wd, holiday: br ? br.label || "عطلة" : null, isToday: date === todayISO });
  }
  return out;
}

export function summarize(recs: { participation: number; disruption: number; late: boolean; absence: string | null; homework: string | null }[]): RecSummary {
  const s: RecSummary = { records: 0, absent: 0, excused: 0, late: 0, participation: 0, disruption: 0, hwDone: 0, hwMissing: 0 };
  for (const r of recs) {
    s.records++;
    if (r.absence === "unexcused") s.absent++;
    if (r.absence === "excused") s.excused++;
    if (r.late) s.late++;
    s.participation += Number(r.participation) || 0;
    s.disruption += Number(r.disruption) || 0;
    if (r.homework === "done") s.hwDone++;
    if (r.homework === "missing") s.hwMissing++;
  }
  return s;
}

type BuildInput = {
  days: Day[];
  slots: (Slot & { subject: SubjectInfo })[];
  sessions: (Session & { subject: SubjectInfo })[];
  summaries: Record<string, RecSummary>; // session_id → ملخص
  settings: Settings;
  now: Date;
};

/** كل حصص الأسبوع: الحصص الموجودة + حصص البرنامج التي لم تُنشأ بعد. */
export function buildWeek({ days, slots, sessions, summaries, settings, now }: BuildInput): { rows: Row[]; instances: Instance[] } {
  const todayISO = toISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const before = settings.schedule.now_before_minutes;
  const after = settings.schedule.now_after_minutes;
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const bySlotDate = new Map<string, Session & { subject: SubjectInfo }>();
  for (const se of sessions) if (se.schedule_slot_id) bySlotDate.set(`${se.schedule_slot_id}|${se.date}`, se);
  const dayDates = new Set(days.map((d) => d.date));

  const out: Instance[] = [];
  const make = (p: Omit<Instance, "status" | "current" | "next">): Instance => {
    const sm = p.summary;
    const st = p.session;
    const s0 = minutes(p.start), e0 = minutes(p.end) ?? (s0 !== null ? s0 + 50 : null);
    const current = p.date === todayISO && s0 !== null && e0 !== null && nowMin >= s0 - before && nowMin <= e0 + after;
    const passed = p.date < todayISO || (p.date === todayISO && e0 !== null && nowMin > e0 + after);
    let status: Status;
    if (st?.cancelled) status = "cancelled";
    else if (sm && sm.records > 0) status = st?.locked ? "locked" : "logged";
    else if (passed) status = "missed";
    else if (current) status = "now";
    else if (p.date === todayISO && s0 === null) status = "today";
    else status = "upcoming";
    return { ...p, status, current, next: false };
  };

  // الحصص الموجودة في قاعدة البيانات
  for (const se of sessions) {
    if (se.deleted_at || !dayDates.has(se.date)) continue;
    const sl = se.schedule_slot_id ? slotById.get(se.schedule_slot_id) ?? null : null;
    out.push(make({
      id: se.id, real: true, session: se, slot: sl, subject: se.subject, date: se.date,
      start: hhmm(sl?.start_time), end: hhmm(sl?.end_time), semester: se.semester,
      summary: summaries[se.id] ?? null,
    }));
  }
  // حصص البرنامج التي لم تُنشأ بعد (لا تظهر في العطل وخارج السنة الدراسية)
  for (const d of days) {
    if (d.holiday || d.date < settings.year.start || d.date > settings.year.end) continue;
    for (const sl of slots) {
      if (sl.weekday !== d.weekday) continue;
      if (bySlotDate.has(`${sl.id}|${d.date}`)) continue; // موجودة (أو محذوفة عمداً)
      const id = sessionIdFor(sl.id, d.date);
      out.push(make({
        id, real: false, session: null, slot: sl, subject: sl.subject, date: d.date,
        start: hhmm(sl.start_time), end: hhmm(sl.end_time), semester: semesterFor(d.date, settings),
        summary: summaries[id] ?? null,
      }));
    }
  }

  // الحصة التالية اليوم
  const upcomingToday = out.filter((i) => i.date === todayISO && i.status === "upcoming" && i.start).sort((a, b) => a.start!.localeCompare(b.start!));
  if (upcomingToday[0]) upcomingToday[0].next = true;

  const rowsMap = new Map<string, Row>();
  for (const i of out) if (i.start) rowsMap.set(`${i.start}-${i.end ?? ""}`, { key: `${i.start}-${i.end ?? ""}`, start: i.start, end: i.end });
  const rows = [...rowsMap.values()].sort((a, b) => a.start!.localeCompare(b.start!) || (a.end ?? "").localeCompare(b.end ?? ""));
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "99").localeCompare(b.start ?? "99") || a.subject.name.localeCompare(b.subject.name, "ar"));
  return { rows, instances: out };
}

export const rowKeyOf = (i: Instance) => (i.start ? `${i.start}-${i.end ?? ""}` : "none");

/** «سُجّلت 9 من 12 حصة»: الحصص التي حان وقتها (بدون الملغاة). */
export function weekProgress(instances: Instance[]) {
  const due = instances.filter((i) => ["logged", "locked", "missed", "now"].includes(i.status));
  const logged = due.filter((i) => i.status === "logged" || i.status === "locked");
  return { due: due.length, logged: logged.length, missing: due.filter((i) => i.status === "missed" || i.status === "now") };
}

export const STATUS_LABEL: Record<Status, string> = {
  logged: "مسجّلة", locked: "مقفلة", cancelled: "ملغاة", now: "الآن", missed: "غير مسجّلة", today: "اليوم", upcoming: "قادمة",
};
