"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassFull, must, type SubjectGrades } from "@/lib/class-data";
import { logError } from "@/lib/errors";
import { fmtDate } from "@/lib/dates";
import { addAtt, attendance, avg, classStats, distribution, num, pct, subjectStats, type Attendance } from "@/lib/stats";
import type { Result } from "@/lib/grades";
import type { ClassRow, Session, Student, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { BarList, Distribution, RankList, Section, StatTile, Tiles, fmtPct } from "@/components/charts";
import { Empty, LoadError, PageHeader, Spinner } from "@/components/ui";
import { DiffCell } from "@/components/compare-views";
import { PrintButton, PrintHeader } from "@/components/print";
import { classCompare, diffOf, hasSemester2 } from "@/lib/compare";

type ClassData = { cls: ClassRow; students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades> };

export default function TeacherStats() {
  const { settings, loaded, subjectWeights } = useSettings();
  const [classes, setClasses] = useState<ClassData[] | null>(null);
  const [edits7, setEdits7] = useState<number | null>(null);
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
      setErr(false);
      const list = must(await supabase().from("classes").select("*").is("deleted_at", null).eq("archived", false).order("created_at")) as ClassRow[];
      const out = await Promise.all(list.map(async (c) => {
        const f = await loadClassFull(c.id, settings, subjectWeights);
        return { cls: c, students: f.students, subjects: f.subjects, data: f.data };
      }));
      setClasses(out);
      const since = new Date(Date.now() - 7 * 864e5).toISOString();
      const { count } = await supabase().from("audit_log").select("id", { count: "exact", head: true }).gte("at", since);
      setEdits7(count ?? 0);
      } catch (e) { logError(e); setErr(true); }
    })();
  }, [loaded, settings, subjectWeights, retry]);

  if (err && !classes) return <LoadError onRetry={() => setRetry((x) => x + 1)} />;
  if (!classes) return <Spinner />;
  if (!classes.length) return <Empty>لا توجد صفوف بعد. أنشئ صفاً لتظهر الإحصائيات.</Empty>;

  const g = settings.grading;
  const L = settings.labels;
  const per = classes.map((c) => ({ ...c, cs: classStats(c.students, c.subjects, c.data, settings) }));
  const allOverall: Result[] = per.flatMap((p) => Object.values(p.cs.overall));
  const numeric = allOverall.map(num).filter((v): v is number => v !== null);
  const passed = numeric.filter((v) => v >= g.pass_mark).length;
  let att: Attendance = attendance(undefined);
  const unlogged: { s: Session; subject: Subject; cls: ClassRow }[] = [];
  let past = 0, logged = 0, subjectsCount = 0;
  for (const p of per) {
    for (const sj of p.subjects) {
      subjectsCount++;
      att = addAtt(att, attendance(p.data[sj.id]));
      const ss = subjectStats(p.students, p.data[sj.id], settings);
      past += ss.sessionsPast;
      logged += ss.sessionsLogged;
      ss.unlogged.forEach((s) => unlogged.push({ s, subject: sj, cls: p.cls }));
    }
  }
  unlogged.sort((a, b) => b.s.date.localeCompare(a.s.date));
  const studentsCount = per.reduce((a, p) => a + p.students.length, 0);
  const atRisk = per.flatMap((p) => p.cs.atRisk.map((r) => ({ ...r, cls: p.cls })));

  return (
    <div>
      <PageHeader info="ملخص كل صفوفك (غير المؤرشفة). اضغط على أي صف أو طالب أو حصة للانتقال إليه. لكل صف ولكل مادة صفحة إحصائيات أيضاً." title="إحصائياتي" sub={`${settings.profile.teacher_name || "الأستاذ"} · السنة الدراسية ${settings.year.school_year}`}
        actions={<PrintButton title="إحصائياتي" />} />
      <PrintHeader title="إحصائياتي" />
      <div className="space-y-4">
        <Tiles>
          <StatTile label="الصفوف / المواد" value={`${per.length} / ${subjectsCount}`} sub={`${studentsCount} طالب`} info="الصفوف غير المؤرشفة فقط." />
          <StatTile label="المعدل العام لكل طلابي" value={avg(numeric) ?? "—"} sub={`من ${g.scale}`} info="متوسط المعدل العام لكل الطلاب في كل الصفوف. قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط." />
          <StatTile label="نسبة النجاح" value={fmtPct(pct(passed, numeric.length))} sub={`${passed} من ${numeric.length}`} tone={numeric.length && passed / numeric.length < 0.5 ? "bad" : "good"}
            info={<>الطلاب الذين معدلهم العام ≥ {g.pass_mark}، في كل الصفوف.</>} />
          <StatTile label="الحصص المسجلة" value={`${logged} / ${past}`} tone={unlogged.length ? "warn" : "good"} sub={unlogged.length ? `${unlogged.length} غير مسجلة` : "كلها مسجلة"}
            info="الحصص التي مضى تاريخها في كل المواد، وكم منها سُجّل." />
          <StatTile label="نسبة الحضور" value={fmtPct(att.attendanceRate)} sub={edits7 !== null ? `${edits7} تعديل هذا الأسبوع` : undefined}
            info="الحضور في كل الحصص المسجلة. «تعديل هذا الأسبوع» = عدد التغييرات في سجل التعديلات خلال 7 أيام." />
        </Tiles>

        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          <Section title="المعدل العام لكل صف" info="متوسط المعدل العام لطلاب كل صف. مرّر الفأرة لرؤية نسبة النجاح.">
            <BarList max={g.scale} marker={{ value: g.pass_mark, label: `علامة النجاح (${g.pass_mark})` }}
              items={per.map((p) => ({ key: p.cls.id, label: p.cls.name, value: p.cs.avgOverall, href: `/class?id=${p.cls.id}`, tip: `نسبة النجاح ${fmtPct(p.cs.passRate)} · ${p.students.length} طالب` }))} />
          </Section>
          <Section title="توزيع التقديرات لكل الطلاب" info="كل طلابك حسب المعدل العام.">
            <Distribution bands={distribution(allOverall, settings)} />
          </Section>
          <Section title="حصص تحتاج تسجيل" info="أحدث الحصص التي مضى تاريخها ولم يُسجَّل فيها شيء.">
            <RankList empty="كل الحصص السابقة مسجلة 👍" items={unlogged.slice(0, 10).map((u) => ({
              key: u.s.id, label: `${fmtDate(u.s.date)} · ${u.subject.name} · ${u.cls.name}`,
              value: <Link href={`/session?id=${u.s.id}`} className="text-brand-600 hover:underline">تسجيل ←</Link>,
            }))} />
          </Section>
          <Section title="طلاب يحتاجون متابعة" info={<>معدل تحت {g.pass_mark}، أو رسوب في مادة، أو حضور أقل من {settings.alerts.low_attendance_rate}% — في كل الصفوف.</>}>
            <RankList empty="لا يوجد 👍" items={atRisk.slice(0, 12).map((r) => ({
              key: r.student.id, label: `${r.student.full_name} · ${r.cls.name}`, href: `/student?id=${r.student.id}`,
              value: <span className="text-xs text-amber-700 dark:text-amber-400">{[
                typeof r.overall === "number" && r.overall < g.pass_mark ? `معدل ${r.overall}` : "",
                r.failing.length ? `راسب في ${r.failing.length}` : "",
                r.att.attendanceRate !== null && r.att.attendanceRate < settings.alerts.low_attendance_rate ? `حضور ${r.att.attendanceRate}%` : "",
              ].filter(Boolean).join(" · ")}</span>,
            }))} />
          </Section>
          <Section title={`${L.participation} و${L.disruption} في كل صف`} info="مجموع ما سُجّل في كل مواد الصف.">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500"><tr><th className="py-1 text-right font-medium">الصف</th><th className="font-medium">{L.participation}</th><th className="font-medium">{L.disruption}</th><th className="font-medium">{L.late}</th><th className="font-medium">{L.absent}</th><th className="font-medium">الحضور</th></tr></thead>
              <tbody>
                {per.map((p) => (
                  <tr key={p.cls.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5"><Link href={`/class?id=${p.cls.id}`} className="hover:text-brand-600 hover:underline">{p.cls.name}</Link></td>
                    <td className="text-center tabular-nums">{p.cs.attendance.participation}</td>
                    <td className="text-center tabular-nums">{p.cs.attendance.disruption}</td>
                    <td className="text-center tabular-nums">{p.cs.attendance.late}</td>
                    <td className="text-center tabular-nums">{p.cs.attendance.absent + p.cs.attendance.excused}</td>
                    <td className="text-center tabular-nums">{fmtPct(p.cs.attendance.attendanceRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title={`${L.term1} مقابل ${L.term2}`} info="لكل صف: المعدل العام في كل نصف والفرق. النصف غير المكتمل يُحسب «حتى الآن» (*). تظهر بعد إدخال أول علامة من النصف الثاني.">
            {per.some((p) => hasSemester2(p.subjects, p.data)) ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-zinc-500"><tr><th className="py-1 text-right font-medium">الصف</th><th className="font-medium">{L.term1}</th><th className="font-medium">{L.term2}</th><th className="font-medium">الفرق</th></tr></thead>
                <tbody>
                  {per.map((p) => {
                    const c = classCompare(p.students, p.subjects, p.data, settings);
                    return (
                      <tr key={p.cls.id} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="py-1.5"><Link href={`/class?id=${p.cls.id}&tab=stats`} className="hover:text-brand-600 hover:underline">{p.cls.name}</Link></td>
                        <td className="text-center tabular-nums">{c.avgA ?? "—"}</td>
                        <td className="text-center tabular-nums">{c.avgB ?? "—"}{c.partialB && c.avgB !== null ? "*" : ""}</td>
                        <td className="text-center"><DiffCell d={diffOf(c.avgA, c.avgB)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <p className="text-sm text-zinc-500">تظهر المقارنة بعد إدخال أول علامة من النصف الثاني.</p>}
          </Section>
          <Section title="أفضل الطلاب" info="أعلى 10 معدلات عامة في كل الصفوف.">
            <RankList empty="لا توجد معدلات بعد." items={per.flatMap((p) => p.cs.ranked.map((r) => ({ ...r, cls: p.cls })))
              .sort((a, b) => b.value - a.value).slice(0, 10)
              .map((r) => ({ key: r.student.id, label: `${r.student.full_name} · ${r.cls.name}`, value: r.value, href: `/student?id=${r.student.id}` }))} />
          </Section>
        </div>
      </div>
    </div>
  );
}
