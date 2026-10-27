"use client";
import type { SubjectGrades } from "./class-data";
import type { Cell, SheetSpec } from "./excel";
import { overallAverage, type Result } from "./grades";
import type { Settings } from "./settings";
import type { Student, Subject } from "./types";

const COLS = ["p1", "p2", "m1", "pr1", "sem1", "p3", "p4", "m2", "pr2", "sem2", "final"] as const;

const res = (v: Result): Cell => (v === null ? "" : v);

/** ورقة بنفس شكل كشف العلامات في ملف الإكسل. */
export function gradeSheet(subject: Subject, className: string, students: Student[], g: SubjectGrades, s: Settings): SheetSpec {
  const L = s.labels as Record<string, string>;
  const header = ["الرقم", "الاسم", ...COLS.map((c) => L[c])];
  const rows = students.map((st, i) => {
    const e = g.entries[st.id] ?? {};
    const r = g.rows[st.id];
    const raw = (c: "p1" | "p2" | "m1" | "p3" | "p4" | "m2"): Cell => (e[c]?.excused ? "معفى" : e[c]?.score ?? "");
    const pr = (c: "pr1" | "pr2"): Cell => (e[c]?.excused ? "معفى" : e[c]?.score ?? res(r[c]));
    return [
      i + 1, st.full_name,
      raw("p1"), raw("p2"), raw("m1"), pr("pr1"), res(r.sem1),
      raw("p3"), raw("p4"), raw("m2"), pr("pr2"), res(r.sem2),
      res(r.final),
    ];
  });
  return {
    name: subject.name,
    title: `${className} — ${subject.name} — ${s.year.school_year}`,
    header,
    rows,
    widths: [7, 32, ...COLS.map(() => 10)],
  };
}

/** ملخص المعدلات النهائية لكل المواد. */
export function summarySheet(className: string, students: Student[], subjects: Subject[], grades: Record<string, SubjectGrades>, s: Settings): SheetSpec {
  const header = ["الرقم", "الاسم", ...subjects.map((x) => x.name), "المعدل العام"];
  const rows = students.map((st, i) => {
    const finals = subjects.map((sj) => grades[sj.id]?.rows[st.id]?.final ?? null);
    const overall = overallAverage(subjects.map((sj, k) => ({ final: finals[k], weight: Number(sj.weight) })), s);
    return [i + 1, st.full_name, ...finals.map(res), res(overall)];
  });
  return { name: "الملخص", title: `${className} — المعدلات النهائية`, header, rows };
}
