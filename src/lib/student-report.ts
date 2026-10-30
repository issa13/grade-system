// تحويل نتيجة get_student_report (رابط الطالب) إلى نفس شكل البيانات في صفحة الأستاذ،
// حتى تُحسب الإحصائيات بنفس المعادلات وتُعرض بنفس المكوّنات.
import { aggregateFromReport } from "./behavior";
import type { SubjectGrades } from "./class-data";
import { computeRow, type BehaviorAgg, type Entries, type GradeRow } from "./grades";
import { effectiveSettings, subjectKey, type Component, type Settings, type SubjectWeights } from "./settings";
import type { Dates, Exam } from "./trajectory";
import type { Assignment, Session, SessionRecord, Student, Subject, Submission } from "./types";

type Entry = { subject_id: string; component: Component; score: number | null; excused: boolean };
type Beh = BehaviorAgg & { subject_id: string; semester: 1 | 2 };
type Asg = { subject_id: string; semester: 1 | 2; done: number; late: number; missing: number };

export type Report = {
  version?: number;
  student: { name: string; number: string | null; class_name: string; school_year: string | null; phone_set?: boolean; phone_pending?: boolean };
  settings: Record<string, unknown>;
  subjects: { id: string; name: string; color: string; weight: number }[];
  entries: Entry[];
  behavior: Beh[];
  assignments: Asg[];
  records?: { session_id: string; date: string; subject_id: string; semester: 1 | 2; participation: number; disruption: number; late: boolean; absence: "excused" | "unexcused" | null; homework: "done" | "missing" | null }[];
  dates?: { subject_id: string; component: string; date: string }[];
  classmates?: { entries: Entry[]; behavior: Beh[]; assignments: Asg[] }[];
};

export const ME = "me";

const pseudo = (id: string, name: string): Student => ({
  id, class_id: "c", full_name: name, student_number: null, notes: null, share_token: "", share_enabled: false,
  active: true, sort_order: 0, deleted_at: null, created_at: "",
});

function toEntries(list: Entry[], subjectId: string): Entries {
  const en: Entries = {};
  for (const e of list) if (e.subject_id === subjectId) en[e.component] = { score: e.score === null || e.score === undefined ? null : Number(e.score), excused: !!e.excused };
  return en;
}

export function buildStudentReport(rep: Report, s: Settings) {
  const me = { ...pseudo(ME, rep.student.name), student_number: rep.student.number };
  const mates = (rep.classmates ?? []).map((_, i) => pseudo(`m${i + 1}`, `طالب ${i + 1}`));
  const pool = [me, ...mates];
  const subjects: Subject[] = rep.subjects.map((x) => ({ id: x.id, class_id: "c", name: x.name, color: x.color, weight: Number(x.weight) || 1, deleted_at: null, created_at: "" }));
  const weights: Record<string, SubjectWeights> = {};
  for (const sj of subjects) {
    const w = rep.settings[subjectKey(sj.id)];
    if (w && typeof w === "object") weights[sj.id] = w as SubjectWeights;
  }
  const myAgg = aggregateFromReport(rep.behavior ?? [], rep.assignments ?? []);
  const mateAgg = (rep.classmates ?? []).map((m) => aggregateFromReport(m.behavior ?? [], m.assignments ?? []));

  // تسجيلات الطالب حصةً حصة ← حصص وتسجيلات بنفس شكل صفحة الأستاذ
  const recs = rep.records ?? [];
  const data: Record<string, SubjectGrades> = {};
  for (const sj of subjects) {
    const eff = effectiveSettings(s, weights[sj.id]);
    const entries: Record<string, Entries> = { [ME]: toEntries(rep.entries ?? [], sj.id) };
    const agg: SubjectGrades["agg"] = { [ME]: myAgg[sj.id] ?? {} };
    (rep.classmates ?? []).forEach((m, i) => {
      entries[mates[i].id] = toEntries(m.entries ?? [], sj.id);
      agg[mates[i].id] = mateAgg[i][sj.id] ?? {};
    });
    const rows: Record<string, GradeRow> = {};
    for (const p of pool) rows[p.id] = computeRow(entries[p.id] ?? {}, eff, agg[p.id]);

    const mine = recs.filter((r) => r.subject_id === sj.id);
    const sessions: Session[] = [];
    const seen = new Set<string>();
    for (const r of mine) {
      if (seen.has(r.session_id)) continue;
      seen.add(r.session_id);
      sessions.push({ id: r.session_id, subject_id: sj.id, schedule_slot_id: null, date: r.date, semester: r.semester, topic: null, cancelled: false, locked: false, deleted_at: null });
    }
    const records: SessionRecord[] = mine.map((r) => ({
      session_id: r.session_id, student_id: ME, participation: Number(r.participation) || 0, disruption: Number(r.disruption) || 0,
      late: !!r.late, absence: r.absence, homework: r.homework, note: null,
    }));
    // الواجبات: مجاميع فقط ← سطور بنفس العدد (للحضور والوظائف المنجزة)
    const assignments: Assignment[] = [];
    const submissions: Submission[] = [];
    for (const a of (rep.assignments ?? []).filter((x) => x.subject_id === sj.id)) {
      const add = (status: Submission["status"], n: number) => {
        for (let k = 0; k < n; k++) {
          const id = `${sj.id}:${a.semester}:${status}:${k}`;
          assignments.push({ id, subject_id: sj.id, title: "", due_date: null, semester: a.semester, max_score: null, deleted_at: null });
          submissions.push({ assignment_id: id, student_id: ME, status, score: null });
        }
      };
      add("done", Number(a.done) || 0);
      add("late", Number(a.late) || 0);
      add("missing", Number(a.missing) || 0);
    }
    data[sj.id] = { entries, agg, rows, sessions, records, assignments, submissions };
  }
  const dates: Record<string, Dates> = {};
  for (const d of rep.dates ?? []) (dates[d.subject_id] ??= {})[d.component as Exam] = d.date;
  return { me, pool, subjects, data, dates, weights };
}
