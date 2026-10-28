// تنبيهات الأستاذ: تُحسب من البيانات الموجودة (في الموقع وفي إيميل النسخة الأسبوعية).
// دوال صافية بدون قاعدة بيانات.
import { aggregate } from "./behavior";
import { datesBetween } from "./dates";
import { computeRow, type Entries, type GradeRow } from "./grades";
import { sessionIdFor } from "./ids";
import { addDays } from "./schedule";
import { effectiveSettings, type Settings, type SubjectWeights } from "./settings";
import { scoreOf } from "./stats";
import { subjectPoints, type Dates, type Exam } from "./trajectory";
import type { AlertState, Assignment, ClassRow, GradeEntry, Session, SessionRecord, Slot, Student, Subject, Submission } from "./types";

export type Rule = "absence_streak" | "low_attendance" | "unlogged" | "hw_streak" | "disruption" | "below_pass" | "drop" | "missing_grades";
export const RULES: Rule[] = ["absence_streak", "unlogged", "low_attendance", "hw_streak", "disruption", "below_pass", "drop", "missing_grades"];

export type AlertItem = {
  key: string;
  rule: Rule;
  label: string; // سطر قصير: اسم الطالب · الصف · المادة
  detail?: string;
  href: string;
  fingerprint: string;
  studentId?: string;
  classId?: string;
  /** حصة لم تُنشأ بعد: تُنشأ عند الضغط ثم تُفتح */
  create?: { id: string; subject_id: string; schedule_slot_id: string; date: string; semester: 1 | 2 };
  date?: string;
};
export type AlertGroup = { rule: Rule; title: string; items: AlertItem[] };

export type AlertData = {
  classes: ClassRow[];
  students: Student[];
  subjects: Subject[];
  slots: Slot[];
  sessions: Session[];
  records: SessionRecord[];
  grades: GradeEntry[];
  assignments: Assignment[];
  submissions: Submission[];
  dates: { subject_id: string; component: string; date: string }[];
  weights: Record<string, SubjectWeights>;
};

const n = (k: number, one: string, two: string, few: string, many: string) =>
  k === 1 ? one : k === 2 ? two : k <= 10 ? `${k} ${few}` : `${k} ${many}`;

export function groupTitle(rule: Rule, k: number, s: Settings): string {
  const A = s.alerts;
  const L = s.labels;
  const students = n(k, "طالب", "طالبان", "طلاب", "طالباً");
  switch (rule) {
    case "absence_streak": return `${students} ${k === 1 ? "غاب" : "غابوا"} ${A.absence_streak} مرات متتالية`;
    case "low_attendance": return `${students} ${k === 1 ? "حضوره" : "حضورهم"} أقل من ${A.low_attendance_rate}%`;
    case "unlogged": return `في ${n(k, "حصة", "حصتين", "حصص", "حصة")} ما سجّلتها`;
    case "hw_streak": return `${students} ${k === 1 ? "لم ينجز" : "لم ينجزوا"} ${L.homework} ${A.hw_streak} مرات متتالية`;
    case "disruption": return `${students} ${k === 1 ? "سُجّل له" : "سُجّل لهم"} ${L.disruption} ${A.disruption_count} مرات أو أكثر خلال ${A.disruption_days} أيام`;
    case "below_pass": return `${students} تحت علامة النجاح (${s.grading.pass_mark}) في مادة`;
    case "drop": return `${n(k, "هبوط مفاجئ", "هبوطان مفاجئان", "حالات هبوط مفاجئ", "حالة هبوط مفاجئ")} في العلامات`;
    case "missing_grades": return `${n(k, "امتحان", "امتحانان", "امتحانات", "امتحاناً")} فيه علامات ناقصة`;
  }
}

export const RULE_ON: Record<Rule, keyof Settings["alerts"]> = {
  absence_streak: "absence_streak_on", low_attendance: "low_attendance_on", unlogged: "unlogged_on", hw_streak: "hw_streak_on",
  disruption: "disruption_on", below_pass: "below_pass_on", drop: "drop_on", missing_grades: "missing_grades_on",
};

/** كل التنبيهات الحالية (قبل تطبيق «تمّ» و«ذكّرني لاحقاً»). */
export function computeAlerts(d: AlertData, s: Settings, todayISO: string): AlertItem[] {
  const A = s.alerts;
  const L = s.labels as Record<string, string>;
  const out: AlertItem[] = [];
  const classById = new Map(d.classes.map((c) => [c.id, c]));
  const subjects = d.subjects.filter((x) => !x.deleted_at && classById.has(x.class_id));
  const subjById = new Map(subjects.map((x) => [x.id, x]));
  const students = d.students.filter((x) => x.active && !x.deleted_at && classById.has(x.class_id));
  const stById = new Map(students.map((x) => [x.id, x]));
  const sessions = d.sessions.filter((x) => !x.deleted_at && subjById.has(x.subject_id));
  const live = sessions.filter((x) => !x.cancelled);
  const sesById = new Map(live.map((x) => [x.id, x]));
  const recsBySession = new Map<string, SessionRecord[]>();
  for (const r of d.records) if (sesById.has(r.session_id)) (recsBySession.get(r.session_id) ?? recsBySession.set(r.session_id, []).get(r.session_id)!).push(r);
  const who = (st: Student, sj?: Subject) => [st.full_name, classById.get(st.class_id)?.name, sj?.name].filter(Boolean).join(" · ");
  const on = (r: Rule) => !!A[RULE_ON[r]];

  // تسجيلات كل طالب في كل مادة، مرتبة من الأحدث
  const logged = live.filter((x) => x.date <= todayISO && recsBySession.has(x.id)).sort((a, b) => b.date.localeCompare(a.date));
  const bySubject = new Map<string, Session[]>();
  for (const x of logged) (bySubject.get(x.subject_id) ?? bySubject.set(x.subject_id, []).get(x.subject_id)!).push(x);
  const recOf = (sid: string, stId: string) => recsBySession.get(sid)?.find((r) => r.student_id === stId);

  for (const sj of subjects) {
    const list = bySubject.get(sj.id) ?? [];
    const pupils = students.filter((x) => x.class_id === sj.class_id);
    for (const st of pupils) {
      // 1) غياب متتالٍ
      if (on("absence_streak")) {
        let k = 0, latest = "";
        for (const se of list) { const r = recOf(se.id, st.id); if (r?.absence) { k++; latest ||= se.id; } else break; }
        if (k >= A.absence_streak) out.push({ rule: "absence_streak", key: `absence_streak:${st.id}:${sj.id}`, label: who(st, sj), detail: `${k} حصص متتالية`, href: `/student?id=${st.id}`, fingerprint: latest, studentId: st.id, classId: st.class_id });
      }
      // 4) وظائف ناقصة متتالية (من الحصص ومن الواجبات)
      if (on("hw_streak")) {
        const marks: { date: string; missing: boolean; id: string }[] = [];
        for (const se of list) { const r = recOf(se.id, st.id); if (r?.homework) marks.push({ date: se.date, missing: r.homework === "missing", id: se.id }); }
        for (const a of d.assignments) {
          if (a.subject_id !== sj.id || a.deleted_at) continue;
          const sub = d.submissions.find((x) => x.assignment_id === a.id && x.student_id === st.id && x.status);
          if (sub) marks.push({ date: a.due_date ?? "", missing: sub.status === "missing", id: a.id });
        }
        marks.sort((a, b) => b.date.localeCompare(a.date));
        let k = 0;
        for (const m of marks) { if (m.missing) k++; else break; }
        if (k >= A.hw_streak) out.push({ rule: "hw_streak", key: `hw_streak:${st.id}:${sj.id}`, label: who(st, sj), detail: `${k} مرات «${L.hw_missing}»`, href: `/student?id=${st.id}`, fingerprint: marks[0].id, studentId: st.id, classId: st.class_id });
      }
    }
  }

  // 2) نسبة حضور منخفضة و 5) شغب متكرر — لكل طالب في كل المواد
  const since = addDays(todayISO, -(A.disruption_days - 1));
  for (const st of students) {
    let total = 0, absent = 0, dis = 0, lastDis = "";
    for (const se of logged) {
      const r = recOf(se.id, st.id);
      if (!r) continue;
      total++;
      if (r.absence) absent++;
      if (se.date >= since && r.disruption > 0) { dis += r.disruption; lastDis ||= se.id; }
    }
    if (on("low_attendance") && total >= A.low_attendance_min_sessions) {
      const rate = Math.round(((total - absent) / total) * 1000) / 10;
      if (rate < A.low_attendance_rate) out.push({ rule: "low_attendance", key: `low_attendance:${st.id}`, label: who(st), detail: `${rate}% (${absent} غياب من ${total})`, href: `/student?id=${st.id}`, fingerprint: String(absent), studentId: st.id, classId: st.class_id });
    }
    if (on("disruption") && dis >= A.disruption_count) out.push({ rule: "disruption", key: `disruption:${st.id}`, label: who(st), detail: `${dis} مرات`, href: `/student?id=${st.id}`, fingerprint: `${lastDis}:${dis}`, studentId: st.id, classId: st.class_id });
  }

  // 3) حصص غير مسجلة: مضى عليها يوم (حصص موجودة + حصص البرنامج في آخر أسبوعين)
  if (on("unlogged")) {
    const until = addDays(todayISO, -A.unlogged_days);
    for (const se of live) {
      if (se.date > until || recsBySession.has(se.id)) continue;
      const sj = subjById.get(se.subject_id)!;
      out.push({ rule: "unlogged", key: `unlogged:${se.id}`, label: `${sj.name} · ${classById.get(sj.class_id)?.name ?? ""}`, detail: se.date, date: se.date, href: `/session?id=${se.id}`, fingerprint: "1", classId: sj.class_id });
    }
    const taken = new Set(d.sessions.filter((x) => x.schedule_slot_id).map((x) => `${x.schedule_slot_id}|${x.date}`));
    const from = [addDays(todayISO, -14), s.year.start].sort().reverse()[0];
    for (const sl of d.slots) {
      const sj = subjById.get(sl.subject_id);
      if (!sj || from > until) continue;
      for (const date of datesBetween(from, until > s.year.end ? s.year.end : until, [sl.weekday], s)) {
        if (taken.has(`${sl.id}|${date}`)) continue;
        const id = sessionIdFor(sl.id, date);
        if (sesById.has(id)) continue;
        out.push({
          rule: "unlogged", key: `unlogged:${id}`, label: `${sj.name} · ${classById.get(sj.class_id)?.name ?? ""}`, detail: date, date, href: `/session?id=${id}`, fingerprint: "1", classId: sj.class_id,
          create: { id, subject_id: sj.id, schedule_slot_id: sl.id, date, semester: date <= s.year.sem1_end ? 1 : 2 },
        });
      }
    }
  }

  // العلامات: تحت النجاح، هبوط مفاجئ، علامات ناقصة
  if (on("below_pass") || on("drop") || on("missing_grades")) {
    const entriesBySubject = new Map<string, Record<string, Entries>>();
    for (const g of d.grades) {
      const m = entriesBySubject.get(g.subject_id) ?? entriesBySubject.set(g.subject_id, {}).get(g.subject_id)!;
      (m[g.student_id] ??= {})[g.component] = { score: g.score === null ? null : Number(g.score), excused: g.excused };
    }
    for (const sj of subjects) {
      const pupils = students.filter((x) => x.class_id === sj.class_id);
      const en = entriesBySubject.get(sj.id) ?? {};
      const eff = effectiveSettings(s, d.weights[sj.id]);
      const agg = aggregate(sessions.filter((x) => x.subject_id === sj.id), d.records, d.assignments.filter((a) => a.subject_id === sj.id), d.submissions);
      const rows: Record<string, GradeRow> = {};
      for (const st of pupils) rows[st.id] = computeRow(en[st.id] ?? {}, eff, agg[st.id]);
      const dates: Dates = {};
      for (const x of d.dates) if (x.subject_id === sj.id) dates[x.component as Exam] = x.date;
      for (const st of pupils) {
        const hasGrades = Object.values(en[st.id] ?? {}).some((e) => e && (e.score !== null || e.excused));
        if (on("below_pass") && hasGrades) {
          const v = scoreOf(rows[st.id]);
          if (v !== null && v < s.grading.pass_mark) out.push({ rule: "below_pass", key: `below_pass:${st.id}:${sj.id}`, label: who(st, sj), detail: `العلامة حتى الآن ${v}`, href: `/subject?id=${sj.id}&tab=grades`, fingerprint: String(v), studentId: st.id, classId: st.class_id });
        }
        if (on("drop")) {
          const pts = subjectPoints(st.id, rows, dates, s);
          const last = pts[pts.length - 1];
          if (last?.drop) out.push({ rule: "drop", key: `drop:${st.id}:${sj.id}:${last.comp}`, label: who(st, sj), detail: `${L[last.comp]}: ${last.score}`, href: `/student?id=${st.id}`, fingerprint: String(last.score), studentId: st.id, classId: st.class_id });
        }
      }
      if (on("missing_grades")) {
        for (const [comp, date] of Object.entries(dates)) {
          if (!date || addDays(date, A.missing_grades_days) > todayISO) continue;
          const missing = pupils.filter((st) => { const e = en[st.id]?.[comp as Exam]; return !e || (!e.excused && (e.score === null || e.score === undefined)); });
          if (missing.length) {
            out.push({ rule: "missing_grades", key: `missing_grades:${sj.id}:${comp}`, label: `${sj.name} · ${classById.get(sj.class_id)?.name ?? ""} · ${L[comp]}`, detail: `${missing.length} بدون علامة`, href: `/subject?id=${sj.id}&tab=grades`, fingerprint: String(missing.length), classId: sj.class_id });
          }
        }
      }
    }
  }
  return out;
}

/** «تمّ» يخفي التنبيه حتى تحدث حالة جديدة، و«ذكّرني بعد أسبوع» حتى ذلك التاريخ. */
export function visibleAlerts(items: AlertItem[], states: AlertState[], todayISO: string): AlertItem[] {
  const st = new Map(states.map((x) => [x.key, x]));
  return items.filter((i) => {
    const x = st.get(i.key);
    if (!x) return true;
    if (x.status === "done") return x.fingerprint !== i.fingerprint;
    return !x.snoozed_until || x.snoozed_until <= todayISO;
  });
}

export function groupAlerts(items: AlertItem[], s: Settings): AlertGroup[] {
  const by = new Map<Rule, AlertItem[]>();
  for (const i of items) (by.get(i.rule) ?? by.set(i.rule, []).get(i.rule)!).push(i);
  return RULES.filter((r) => by.has(r)).map((r) => {
    const items = by.get(r)!.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.label.localeCompare(b.label, "ar"));
    return { rule: r, title: groupTitle(r, items.length, s), items };
  });
}
