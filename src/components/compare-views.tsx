"use client";
import type { SubjectGrades } from "@/lib/class-data";
import { classCompare, diffOf, hasSemester2, studentCompare, subjectCompare, type Diff, type SemVal } from "@/lib/compare";
import type { Student, Subject } from "@/lib/types";
import { fmtPct, RankList, Section } from "./charts";
import { PairBars } from "./trajectory-chart";
import { useSettings } from "./settings-provider";
import { cx } from "./ui";

const NOTE = "تظهر المقارنة بعد إدخال أول علامة من النصف الثاني.";
const INFO = "النصف غير المكتمل يُحسب «حتى الآن» بالعلامات الموجودة (علامة *). الفرق أقل من نصف نقطة = «ثابت». النصف الذي له إعدادات محفوظة سابقة يُحسب بها كما في كشف العلامات.";

export function DiffCell({ d, invert, unit = "" }: { d: Diff; invert?: boolean; unit?: string }) {
  if (d.value === null || d.dir === null) return <span className="text-zinc-400">—</span>;
  if (d.dir === "flat") return <span className="text-zinc-500">ثابت</span>;
  const good = invert ? d.dir === "down" : d.dir === "up";
  return (
    <span className={cx("font-medium tabular-nums", good ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
      {d.dir === "up" ? "↑" : "↓"} {d.value > 0 ? "+" : ""}{d.value}{unit}
    </span>
  );
}
const val = (v: SemVal) => v.value === null ? <span className="text-zinc-400">—</span> : <span className="tabular-nums">{v.value}{v.partial && <span className="text-zinc-400" title="حتى الآن">*</span>}</span>;

/** صفحة الطالب: المادة · النصف 1 · النصف 2 · الفرق، مع الحضور والسلوك. */
export function StudentCompare({ student, subjects, data }: { student: Student; subjects: Subject[]; data: Record<string, SubjectGrades> }) {
  const { settings } = useSettings();
  const L = settings.labels;
  if (!hasSemester2(subjects, data)) return <Section title={`مقارنة ${L.term1} و${L.term2}`} info={INFO}><p className="text-sm text-zinc-500">{NOTE}</p></Section>;
  const c = studentCompare(student, subjects, data);
  const a1 = c.att[1], a2 = c.att[2];
  // لا مقارنة للحضور والسلوك قبل وجود حصص مسجلة في النصفين
  const both = a1.sessions > 0 && a2.sessions > 0;
  const n2 = (v: number | null) => (a2.sessions ? v : null);
  return (
    <Section title={`مقارنة ${L.term1} و${L.term2}`} info={INFO}>
      <div className="table-scroll">
        <table className="sheet w-full min-w-[420px] text-sm">
          <thead><tr><th className="text-right">المادة</th><th>{L.sem1}</th><th>{L.sem2}</th><th>الفرق</th></tr></thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.subject.id}>
                <td className="px-2 py-1.5">{r.subject.name}</td>
                <td className="text-center">{val(r.a)}</td>
                <td className="text-center">{val(r.b)}</td>
                <td className="text-center"><DiffCell d={r.diff} /></td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="px-2 py-1.5">المعدل العام</td>
              <td className="text-center">{val(c.overall.a)}</td><td className="text-center">{val(c.overall.b)}</td><td className="text-center"><DiffCell d={c.overall.diff} /></td>
            </tr>
            <tr className="text-zinc-600 dark:text-zinc-400">
              <td className="px-2 py-1.5">نسبة الحضور</td>
              <td className="text-center">{fmtPct(a1.attendanceRate)}</td><td className="text-center">{fmtPct(a2.attendanceRate)}</td>
              <td className="text-center"><DiffCell d={both ? diffOf(a1.attendanceRate, a2.attendanceRate) : { value: null, dir: null }} unit="%" /></td>
            </tr>
            <tr className="text-zinc-600 dark:text-zinc-400">
              <td className="px-2 py-1.5">{L.participation}</td>
              <td className="text-center tabular-nums">{a1.participation}</td><td className="text-center tabular-nums">{n2(a2.participation) ?? "—"}</td>
              <td className="text-center"><DiffCell d={both ? diffOf(a1.participation, a2.participation) : { value: null, dir: null }} /></td>
            </tr>
            <tr className="text-zinc-600 dark:text-zinc-400">
              <td className="px-2 py-1.5">{L.disruption}</td>
              <td className="text-center tabular-nums">{a1.disruption}</td><td className="text-center tabular-nums">{n2(a2.disruption) ?? "—"}</td>
              <td className="text-center"><DiffCell d={both ? diffOf(a1.disruption, a2.disruption) : { value: null, dir: null }} invert /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** إحصائيات المادة: معدل الصف ونسبة النجاح في كل نصف، والأكثر تحسّناً وتراجعاً. */
export function SubjectCompare({ students, data }: { students: Student[]; data: SubjectGrades }) {
  const { settings } = useSettings();
  const L = settings.labels;
  const title = `مقارنة ${L.term1} و${L.term2}`;
  const has = Object.values(data.entries).some((e) => (["p3", "p4", "m2"] as const).some((c) => e[c]?.score !== null && e[c]?.score !== undefined));
  if (!has) return <Section title={title} info={INFO}><p className="text-sm text-zinc-500">{NOTE}</p></Section>;
  const c = subjectCompare(students, data, settings);
  return (
    <Section title={title} info={INFO}>
      <table className="mb-4 w-full text-sm">
        <thead className="text-xs text-zinc-500"><tr><th className="py-1 text-right font-medium" /><th className="font-medium">{L.term1}</th><th className="font-medium">{L.term2}</th><th className="font-medium">الفرق</th></tr></thead>
        <tbody>
          <tr className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-1.5">معدل الصف</td><td className="text-center tabular-nums">{c.avgA ?? "—"}</td><td className="text-center tabular-nums">{c.avgB ?? "—"}{c.partialB && "*"}</td><td className="text-center"><DiffCell d={diffOf(c.avgA, c.avgB)} /></td></tr>
          <tr className="border-t border-zinc-100 dark:border-zinc-800"><td className="py-1.5">نسبة النجاح</td><td className="text-center">{fmtPct(c.passA)}</td><td className="text-center">{fmtPct(c.passB)}</td><td className="text-center"><DiffCell d={diffOf(c.passA, c.passB)} unit="%" /></td></tr>
        </tbody>
      </table>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-xs font-semibold text-green-700 dark:text-green-400">الأكثر تحسّناً</h4>
          <RankList empty="—" items={c.improved.map((p) => ({ key: p.student.id, label: p.student.full_name, href: `/student?id=${p.student.id}`, value: <DiffCell d={p.diff} /> }))} />
        </div>
        <div>
          <h4 className="mb-1 text-xs font-semibold text-red-600 dark:text-red-400">الأكثر تراجعاً</h4>
          <RankList empty="—" items={c.declined.map((p) => ({ key: p.student.id, label: p.student.full_name, href: `/student?id=${p.student.id}`, value: <DiffCell d={p.diff} /> }))} />
        </div>
      </div>
    </Section>
  );
}

/** إحصائيات الصف: أعمدة متجاورة لكل مادة، والمعدل العام في كل نصف. */
export function ClassCompare({ students, subjects, data }: { students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades> }) {
  const { settings } = useSettings();
  const L = settings.labels;
  const title = `مقارنة ${L.term1} و${L.term2}`;
  if (!hasSemester2(subjects, data)) return <Section title={title} info={INFO}><p className="text-sm text-zinc-500">{NOTE}</p></Section>;
  const c = classCompare(students, subjects, data, settings);
  return (
    <Section title={title} info={INFO}>
      <p className="mb-3 text-sm">المعدل العام: <b className="tabular-nums">{c.avgA ?? "—"}</b> ← <b className="tabular-nums">{c.avgB ?? "—"}{c.partialB && "*"}</b> <DiffCell d={diffOf(c.avgA, c.avgB)} /></p>
      <PairBars max={settings.grading.scale} pass={settings.grading.pass_mark} labels={[L.term1, L.term2]}
        items={c.perSubject.map((p) => ({ key: p.subject.id, label: p.subject.name, a: p.avgA, b: p.avgB, bPartial: p.partialB }))} />
    </Section>
  );
}
