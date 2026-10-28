// مقارنة النصف الأول بالنصف الثاني.
import type { SubjectGrades } from "./class-data";
import { semesterValue } from "./grades";
import type { Settings } from "./settings";
import { attendance, avg, pct, type Attendance } from "./stats";
import type { Student, Subject } from "./types";

export type SemVal = { value: number | null; partial: boolean };
export type Diff = { value: number | null; dir: "up" | "down" | "flat" | null };

/** الفرق أقل من نصف نقطة = «ثابت» بدون سهم. */
export function diffOf(a: number | null, b: number | null): Diff {
  if (a === null || b === null) return { value: null, dir: null };
  const d = Math.round((b - a) * 100) / 100;
  return { value: d, dir: Math.abs(d) < 0.5 ? "flat" : d > 0 ? "up" : "down" };
}

/** تظهر المقارنة بعد إدخال أول علامة من النصف الثاني (في أي مادة من الصف). */
export function hasSemester2(subjects: Subject[], data: Record<string, SubjectGrades>): boolean {
  return subjects.some((sj) => Object.values(data[sj.id]?.entries ?? {}).some((e) =>
    (["p3", "p4", "m2"] as const).some((c) => e[c] && (e[c]!.score !== null && e[c]!.score !== undefined))));
}

/** معدل الطالب العام في نصف: معدل المواد حسب وزن كل مادة. */
export function overallSem(st: string, subjects: Subject[], data: Record<string, SubjectGrades>, sem: 1 | 2): SemVal {
  let n = 0, d = 0, partial = false;
  for (const sj of subjects) {
    const v = semesterValue(data[sj.id]?.rows[st], sem);
    if (v.value === null) continue;
    n += v.value * Number(sj.weight);
    d += Number(sj.weight);
    partial ||= v.partial;
  }
  return { value: d ? Math.round((n / d) * 100) / 100 : null, partial };
}

export function studentCompare(st: Student, subjects: Subject[], data: Record<string, SubjectGrades>) {
  const rows = subjects.map((sj) => {
    const a = semesterValue(data[sj.id]?.rows[st.id], 1);
    const b = semesterValue(data[sj.id]?.rows[st.id], 2);
    return { subject: sj, a, b, diff: diffOf(a.value, b.value) };
  });
  const a = overallSem(st.id, subjects, data, 1), b = overallSem(st.id, subjects, data, 2);
  const att = (sem: 1 | 2) => {
    let x: Attendance = attendance(undefined);
    for (const sj of subjects) {
      const y = attendance(data[sj.id], st.id, sem);
      x = { ...x, sessions: x.sessions + y.sessions, absent: x.absent + y.absent, excused: x.excused + y.excused, late: x.late + y.late, participation: x.participation + y.participation, disruption: x.disruption + y.disruption, hwDone: x.hwDone + y.hwDone, hwMissing: x.hwMissing + y.hwMissing };
    }
    x.attendanceRate = x.sessions ? Math.round(((x.sessions - x.absent - x.excused) / x.sessions) * 1000) / 10 : null;
    return x;
  };
  return { rows, overall: { a, b, diff: diffOf(a.value, b.value) }, att: { 1: att(1), 2: att(2) } };
}

/** إحصائيات مادة: معدل الصف ونسبة النجاح في كل نصف، والأكثر تحسّناً وتراجعاً. */
export function subjectCompare(students: Student[], data: SubjectGrades | undefined, s: Settings) {
  const per = students.map((st) => {
    const a = semesterValue(data?.rows[st.id], 1), b = semesterValue(data?.rows[st.id], 2);
    return { student: st, a, b, diff: diffOf(a.value, b.value) };
  });
  const passRate = (sem: "a" | "b") => {
    const v = per.map((p) => p[sem].value).filter((x): x is number => x !== null);
    return pct(v.filter((x) => x >= s.grading.pass_mark).length, v.length);
  };
  const withDiff = per.filter((p) => p.diff.value !== null);
  return {
    avgA: avg(per.map((p) => p.a.value)), avgB: avg(per.map((p) => p.b.value)),
    partialB: per.some((p) => p.b.partial),
    passA: passRate("a"), passB: passRate("b"),
    improved: [...withDiff].filter((p) => p.diff.value! > 0).sort((x, y) => y.diff.value! - x.diff.value!).slice(0, 5),
    declined: [...withDiff].filter((p) => p.diff.value! < 0).sort((x, y) => x.diff.value! - y.diff.value!).slice(0, 5),
  };
}

/** إحصائيات صف: معدل كل مادة في كل نصف، والمعدل العام في كل نصف. */
export function classCompare(students: Student[], subjects: Subject[], data: Record<string, SubjectGrades>, s: Settings) {
  const perSubject = subjects.map((sj) => ({ subject: sj, ...subjectCompare(students, data[sj.id], s) }));
  const oa = students.map((st) => overallSem(st.id, subjects, data, 1));
  const ob = students.map((st) => overallSem(st.id, subjects, data, 2));
  return { perSubject, avgA: avg(oa.map((x) => x.value)), avgB: avg(ob.map((x) => x.value)), partialB: ob.some((x) => x.partial) };
}
