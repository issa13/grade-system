"use client";
import type { SubjectGrades } from "./class-data";
import type { Cell, SheetSpec } from "./excel-types";
import { overallAverage, semesterValue, type Result } from "./grades";
import { diffOf, overallSem } from "./compare";
import type { Component, Settings } from "./settings";
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
    // كل العلامات المصدَّرة محوّلة إلى السلم (من 20 افتراضياً)، مهما كانت العلامة القصوى عند الإدخال
    const v = (c: Component): Cell => (e[c]?.excused ? "معفى" : res(r[c]));
    return [
      i + 1, st.full_name,
      v("p1"), v("p2"), v("m1"), v("pr1"), res(r.sem1),
      v("p3"), v("p4"), v("m2"), v("pr2"), res(r.sem2),
      res(r.final),
    ];
  });
  return {
    name: subject.name,
    title: `${className} — ${subject.name} — ${s.year.school_year} — العلامات من ${s.grading.scale}`,
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
  return { name: "الملخص", title: `${className} — المعدلات النهائية (من ${s.grading.scale})`, header, rows };
}

/** ورقة «مقارنة النصفين»: لكل طالب ولكل مادة معدل النصف 1 و 2 والفرق. (* = حتى الآن) */
export function compareSheet(className: string, students: Student[], subjects: Subject[], grades: Record<string, SubjectGrades>, s: Settings): SheetSpec {
  const L = s.labels as Record<string, string>;
  const header = ["الرقم", "الاسم"];
  for (const sj of subjects) header.push(`${sj.name} — ${L.sem1}`, `${sj.name} — ${L.sem2}`, `${sj.name} — الفرق`);
  header.push(`المعدل العام — ${L.term1}`, `المعدل العام — ${L.term2}`, "الفرق");
  const cell = (v: { value: number | null; partial: boolean }): Cell => (v.value === null ? "" : v.partial ? `${v.value}*` : v.value);
  const rows = students.map((st, i) => {
    const r: Cell[] = [i + 1, st.full_name];
    for (const sj of subjects) {
      const a = semesterValue(grades[sj.id]?.rows[st.id], 1), b = semesterValue(grades[sj.id]?.rows[st.id], 2);
      r.push(cell(a), cell(b), diffOf(a.value, b.value).value ?? "");
    }
    const a = overallSem(st.id, subjects, grades, 1), b = overallSem(st.id, subjects, grades, 2);
    r.push(cell(a), cell(b), diffOf(a.value, b.value).value ?? "");
    return r;
  });
  return { name: "مقارنة النصفين", title: `${className} — مقارنة ${L.term1} و${L.term2} (* = حتى الآن)`, header, rows, widths: [7, 30, ...header.slice(2).map(() => 12)] };
}
