// حساب الإحصائيات: لكل طالب، لكل مادة، لكل صف، وللأستاذ.
import type { SubjectGrades } from "./class-data";
import { bandFor, overallAverage, type GradeRow, type Result } from "./grades";
import { COMPONENTS, type Component, type Settings } from "./settings";
import type { Student, Subject } from "./types";

export const num = (v: Result | undefined): number | null => (typeof v === "number" ? v : null);

/** العلامة المستعملة في الإحصائيات: النهائي إذا اكتمل، وإلا العلامة حتى الآن. */
export const scoreOf = (row: GradeRow | undefined): number | null => (row ? num(row.final) ?? row.current : null);

export function avg(values: (number | null | undefined)[]): number | null {
  const n = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  return n.length ? Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 100) / 100 : null;
}

export function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : null;
}

export type Attendance = {
  sessions: number; // حصص مسجلة للطالب
  absent: number; // غياب بدون عذر
  excused: number; // غياب بعذر
  late: number;
  participation: number;
  disruption: number;
  hwDone: number;
  hwMissing: number;
  attendanceRate: number | null; // نسبة الحضور %
};

const emptyAtt = (): Attendance => ({ sessions: 0, absent: 0, excused: 0, late: 0, participation: 0, disruption: 0, hwDone: 0, hwMissing: 0, attendanceRate: null });

/** الحضور والسلوك لطالب في مادة (أو لكل الطلاب إذا studentId غير محدد). */
export function attendance(data: SubjectGrades | undefined, studentId?: string, semester?: 1 | 2): Attendance {
  const a = emptyAtt();
  if (!data?.sessions) return a;
  const live = new Map(data.sessions.filter((s) => !s.cancelled && !s.deleted_at && (!semester || s.semester === semester)).map((s) => [s.id, s]));
  for (const r of data.records ?? []) {
    if (!live.has(r.session_id) || (studentId && r.student_id !== studentId)) continue;
    a.sessions++;
    if (r.absence === "unexcused") a.absent++;
    if (r.absence === "excused") a.excused++;
    if (r.late) a.late++;
    a.participation += r.participation;
    a.disruption += r.disruption;
    if (r.homework === "done") a.hwDone++;
    if (r.homework === "missing") a.hwMissing++;
  }
  const liveA = new Set((data.assignments ?? []).filter((x) => !x.deleted_at && (!semester || x.semester === semester)).map((x) => x.id));
  for (const s of data.submissions ?? []) {
    if (!liveA.has(s.assignment_id) || (studentId && s.student_id !== studentId)) continue;
    if (s.status === "done" || s.status === "late") a.hwDone++;
    if (s.status === "missing") a.hwMissing++;
  }
  a.attendanceRate = a.sessions ? Math.round(((a.sessions - a.absent - a.excused) / a.sessions) * 1000) / 10 : null;
  return a;
}

export function addAtt(a: Attendance, b: Attendance): Attendance {
  const o = { ...a };
  for (const k of ["sessions", "absent", "excused", "late", "participation", "disruption", "hwDone", "hwMissing"] as const) o[k] += b[k];
  o.attendanceRate = o.sessions ? Math.round(((o.sessions - o.absent - o.excused) / o.sessions) * 1000) / 10 : null;
  return o;
}

export type BandCount = { label: string; color: string; count: number };

/** توزيع العلامات على سلّم التقديرات، مع NC وغير المصحح. */
export function distribution(values: Result[], s: Settings): BandCount[] {
  const bands = [...s.grading.bands].sort((a, b) => b.min - a.min).map((b) => ({ label: b.label, color: b.color, count: 0 }));
  let nc = 0, empty = 0;
  for (const v of values) {
    if (v === null) { empty++; continue; }
    if (v === "NC") { nc++; continue; }
    const b = bandFor(v, s);
    const hit = bands.find((x) => x.label === b?.label);
    if (hit) hit.count++;
  }
  if (nc) bands.push({ label: "NC (غير مكتمل)", color: "#a1a1aa", count: nc });
  if (empty) bands.push({ label: "بدون علامات", color: "#d4d4d8", count: empty });
  return bands;
}

export type Ranked = { student: Student; value: number };

export function ranking(students: Student[], valueOf: (s: Student) => Result): Ranked[] {
  return students
    .map((st) => ({ student: st, value: num(valueOf(st)) }))
    .filter((x): x is Ranked => x.value !== null)
    .sort((a, b) => b.value - a.value);
}

/** ترتيب الطالب (1 = الأول) مع مراعاة التعادل. */
export function rankOf(ranked: Ranked[], studentId: string): number | null {
  const me = ranked.find((r) => r.student.id === studentId);
  if (!me) return null;
  return ranked.filter((r) => r.value > me.value).length + 1;
}

// ---------------- مادة ----------------
export function subjectStats(students: Student[], data: SubjectGrades | undefined, s: Settings) {
  const rows = data?.rows ?? {};
  const finals: Result[] = students.map((st) => scoreOf(rows[st.id]) ?? (rows[st.id]?.final === "NC" ? "NC" : null));
  const numeric = finals.map((v) => num(v));
  const complete = students.filter((st) => typeof rows[st.id]?.final === "number").length;
  const graded = numeric.filter((v): v is number => v !== null);
  const passed = graded.filter((v) => v >= s.grading.pass_mark).length;
  const compAvg = Object.fromEntries(COMPONENTS.map((c) => [c, avg(students.map((st) => num(rows[st.id]?.[c])))])) as Record<Component, number | null>;
  const ranked = ranking(students, (st) => scoreOf(rows[st.id]));
  const today = new Date().toISOString().slice(0, 10);
  const sessions = (data?.sessions ?? []).filter((x) => !x.cancelled && !x.deleted_at);
  const loggedIds = new Set((data?.records ?? []).map((r) => r.session_id));
  const past = sessions.filter((x) => x.date <= today);
  const att = attendance(data);
  const perStudentAtt = students.map((st) => ({ student: st, att: attendance(data, st.id) }));
  return {
    count: students.length,
    graded: graded.length,
    complete,
    avgFinal: avg(numeric),
    avgSem1: avg(students.map((st) => num(rows[st.id]?.sem1))),
    avgSem2: avg(students.map((st) => num(rows[st.id]?.sem2))),
    maxFinal: graded.length ? Math.max(...graded) : null,
    minFinal: graded.length ? Math.min(...graded) : null,
    passed,
    failed: graded.length - passed,
    passRate: pct(passed, graded.length),
    nc: finals.filter((v) => v === "NC").length,
    distribution: distribution(finals, s),
    compAvg,
    ranked,
    sessionsTotal: sessions.length,
    sessionsPast: past.length,
    sessionsLogged: past.filter((x) => loggedIds.has(x.id)).length,
    unlogged: past.filter((x) => !loggedIds.has(x.id)).sort((a, b) => b.date.localeCompare(a.date)),
    attendance: att,
    mostAbsent: perStudentAtt.filter((x) => x.att.absent + x.att.excused > 0).sort((a, b) => b.att.absent + b.att.excused - (a.att.absent + a.att.excused)),
    mostParticipation: perStudentAtt.filter((x) => x.att.participation > 0).sort((a, b) => b.att.participation - a.att.participation),
    mostDisruption: perStudentAtt.filter((x) => x.att.disruption > 0).sort((a, b) => b.att.disruption - a.att.disruption),
  };
}

// ---------------- صف ----------------
export function studentOverall(st: Student, subjects: Subject[], data: Record<string, SubjectGrades>, s: Settings): Result {
  return overallAverage(subjects.map((sj) => ({ final: data[sj.id]?.rows[st.id]?.final ?? null, weight: Number(sj.weight) })), s);
}

/** المعدل العام حتى الآن (من المواد التي فيها علامات). */
export function studentCurrent(st: Student, subjects: Subject[], data: Record<string, SubjectGrades>): number | null {
  let n = 0, d = 0;
  for (const sj of subjects) {
    const v = scoreOf(data[sj.id]?.rows[st.id]);
    if (v !== null) { n += v * Number(sj.weight); d += Number(sj.weight); }
  }
  return d ? Math.round((n / d) * 100) / 100 : null;
}

export function classStats(students: Student[], subjects: Subject[], data: Record<string, SubjectGrades>, s: Settings) {
  const finalOverall = Object.fromEntries(students.map((st) => [st.id, studentOverall(st, subjects, data, s)])) as Record<string, Result>;
  // للإحصائيات: المعدل النهائي إذا اكتمل، وإلا المعدل حتى الآن
  const overall = Object.fromEntries(students.map((st) => {
    const f = finalOverall[st.id];
    return [st.id, typeof f === "number" ? f : studentCurrent(st, subjects, data) ?? f];
  })) as Record<string, Result>;
  const numeric = Object.values(overall).map(num).filter((v): v is number => v !== null);
  const passed = numeric.filter((v) => v >= s.grading.pass_mark).length;
  const perSubject = subjects.map((sj) => ({ subject: sj, stats: subjectStats(students, data[sj.id], s) }));
  let att = emptyAtt();
  for (const sj of subjects) att = addAtt(att, attendance(data[sj.id]));
  const perStudent = students.map((st) => {
    let a = emptyAtt();
    for (const sj of subjects) a = addAtt(a, attendance(data[sj.id], st.id));
    const failing = subjects.filter((sj) => { const f = scoreOf(data[sj.id]?.rows[st.id]); return f !== null && f < s.grading.pass_mark; });
    return { student: st, overall: overall[st.id], att: a, failing };
  });
  const ranked = ranking(students, (st) => overall[st.id]);
  // طلاب يحتاجون متابعة: معدل تحت النجاح، أو رسوب في مادة، أو حضور أقل من 80%
  const atRisk = perStudent.filter((p) => {
    const o = num(p.overall);
    return (o !== null && o < s.grading.pass_mark) || p.failing.length > 0 || (p.att.attendanceRate !== null && p.att.attendanceRate < s.alerts.low_attendance_rate);
  });
  return {
    overall,
    finalOverall,
    complete: Object.values(finalOverall).filter((v) => typeof v === "number").length,
    avgOverall: avg(numeric),
    graded: numeric.length,
    passed,
    passRate: pct(passed, numeric.length),
    distribution: distribution(Object.values(overall), s),
    perSubject,
    perStudent,
    ranked,
    atRisk,
    attendance: att,
  };
}
