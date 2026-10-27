"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadSubjectGrades, type SubjectGrades } from "@/lib/class-data";
import { fmtDate } from "@/lib/dates";
import { fmt } from "@/lib/grades";
import { COMPONENTS } from "@/lib/settings";
import { classStats, subjectStats } from "@/lib/stats";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { BarList, Distribution, RankList, Section, StatTile, Tiles, fmtPct } from "./charts";
import { useSettings } from "./settings-provider";
import { Empty, Spinner } from "./ui";

const studentHref = (id: string) => `/student?id=${id}`;

// ======================= إحصائيات مادة =======================
export function SubjectStatsView({ subject, students }: { subject: Subject; students: Student[] }) {
  const { settings, loaded, subjectWeights } = useSettings();
  const [data, setData] = useState<SubjectGrades | null>(null);
  useEffect(() => {
    if (!loaded) return;
    loadSubjectGrades(subject.id, students, settings, subjectWeights[subject.id]).then(setData);
  }, [subject.id, students, settings, loaded, subjectWeights]);

  if (!data) return <Spinner />;
  if (!students.length) return <Empty>لا يوجد طلاب.</Empty>;
  const st = subjectStats(students, data, settings);
  const L = settings.labels as Record<string, string>;
  const g = settings.grading;

  return (
    <div className="space-y-4">
      <Tiles>
        <StatTile label={st.complete === st.count ? "معدل المادة" : "معدل المادة حتى الآن"} value={st.avgFinal ?? "—"} sub={`من ${g.scale} · ${st.complete} من ${st.count} اكتمل ${L.final} عندهم`}
          info={<>متوسط علامة «{L.final}» لكل الطلاب. قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط.</>} />
        <StatTile label="نسبة النجاح" value={fmtPct(st.passRate)} tone={st.passRate !== null && st.passRate < 50 ? "bad" : "good"}
          sub={`${st.passed} ناجح · ${st.failed} راسب`} info={<>نسبة الطلاب الذين علامتهم ≥ علامة النجاح ({g.pass_mark}). قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط.</>} />
        <StatTile label="أعلى / أدنى علامة" value={st.maxFinal === null ? "—" : `${st.maxFinal} / ${st.minFinal}`} info="أعلى وأدنى علامة نهائية في هذه المادة." />
        <StatTile label="نسبة الحضور" value={fmtPct(st.attendance.attendanceRate)} tone={st.attendance.attendanceRate !== null && st.attendance.attendanceRate < 85 ? "warn" : undefined}
          sub={`${st.attendance.absent} غياب بدون عذر · ${st.attendance.excused} بعذر`}
          info="عدد مرات الحضور ÷ كل التسجيلات في الحصص المسجلة. الحصص الملغاة لا تُحسب." />
        <StatTile label="الحصص المسجلة" value={`${st.sessionsLogged} / ${st.sessionsPast}`} tone={st.unlogged.length ? "warn" : "good"}
          sub={st.unlogged.length ? `${st.unlogged.length} حصة سابقة غير مسجلة` : "كل الحصص السابقة مسجلة"}
          info="الحصص التي تاريخها اليوم أو قبله، وكم منها سُجّل فيها الحضور أو السلوك." />
      </Tiles>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="توزيع التقديرات" info={<>كل طالب حسب علامته على سلّم التقديرات (من الإعدادات). قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط. NC = لا توجد أي علامة صالحة بعد.</>}>
          <Distribution bands={st.distribution} />
        </Section>
        <Section title="معدل كل علامة" info={<>متوسط كل عمود في كشف العلامات بعد تحويله إلى {g.scale}. يساعد على معرفة أي امتحان كان أصعب.</>}>
          <BarList max={g.scale} marker={{ value: g.pass_mark, label: `علامة النجاح (${g.pass_mark})` }}
            items={[...COMPONENTS.slice(0, 4), "sem1" as const, ...COMPONENTS.slice(4), "sem2" as const].map((c) => {
              const v = c === "sem1" ? st.avgSem1 : c === "sem2" ? st.avgSem2 : st.compAvg[c];
              return { key: c, label: L[c], value: v };
            }).filter((x) => x.value !== null)} />
        </Section>
        <Section title="الأعلى علامة" info="أعلى 5 طلاب حسب العلامة النهائية في هذه المادة. قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط.">
          <RankList items={st.ranked.slice(0, 5).map((r) => ({ key: r.student.id, label: r.student.full_name, value: r.value, href: studentHref(r.student.id) }))} empty="لا توجد علامات نهائية بعد." />
        </Section>
        <Section title="يحتاجون متابعة" info={<>أدنى 5 علامات نهائية تحت علامة النجاح ({g.pass_mark}).</>}>
          <RankList items={[...st.ranked].reverse().filter((r) => r.value < g.pass_mark).slice(0, 5).map((r) => ({ key: r.student.id, label: r.student.full_name, value: <span className="text-red-600">{r.value}</span>, href: studentHref(r.student.id) }))} empty="لا يوجد طالب تحت علامة النجاح 👍" />
        </Section>
        <Section title={`الأكثر ${L.participation}`} info="مجموع المشاركات المسجلة في الحصص.">
          <RankList items={st.mostParticipation.slice(0, 5).map((x) => ({ key: x.student.id, label: x.student.full_name, value: x.att.participation, href: studentHref(x.student.id) }))} empty="لا توجد مشاركات مسجلة." />
        </Section>
        <Section title={`الأكثر ${L.absent}`} info="مجموع الغياب (بعذر وبدون عذر) في هذه المادة.">
          <RankList items={st.mostAbsent.slice(0, 5).map((x) => ({ key: x.student.id, label: x.student.full_name, value: `${x.att.absent + x.att.excused}${x.att.excused ? ` (${x.att.excused} بعذر)` : ""}`, href: studentHref(x.student.id) }))} empty="لا يوجد غياب مسجل 👍" />
        </Section>
        <Section title={`الأكثر ${L.disruption}`} info="مجموع مرات الشغب المسجلة.">
          <RankList items={st.mostDisruption.slice(0, 5).map((x) => ({ key: x.student.id, label: x.student.full_name, value: x.att.disruption, href: studentHref(x.student.id) }))} empty="لا يوجد شغب مسجل 👍" />
        </Section>
        <Section title="حصص سابقة غير مسجلة" info="حصص مضى تاريخها ولم يُسجَّل فيها أي شيء. اضغط للتسجيل.">
          <RankList items={st.unlogged.slice(0, 8).map((x) => ({ key: x.id, label: fmtDate(x.date), value: <Link href={`/session?id=${x.id}`} className="text-brand-600 hover:underline">تسجيل ←</Link> }))} empty="كل الحصص السابقة مسجلة 👍" />
        </Section>
      </div>
    </div>
  );
}

// ======================= إحصائيات صف =======================
export function ClassStatsView({ cls, students, subjects }: { cls: ClassRow; students: Student[]; subjects: Subject[] }) {
  const { settings, loaded, subjectWeights } = useSettings();
  const [data, setData] = useState<Record<string, SubjectGrades> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const out: Record<string, SubjectGrades> = {};
      await Promise.all(subjects.map(async (sj) => { out[sj.id] = await loadSubjectGrades(sj.id, students, settings, subjectWeights[sj.id]); }));
      setData(out);
    })();
  }, [subjects, students, settings, loaded, subjectWeights]);

  if (!data) return <Spinner />;
  if (!subjects.length) return <Empty>أضف مواد أولاً.</Empty>;
  if (!students.length) return <Empty>لا يوجد طلاب.</Empty>;
  const cs = classStats(students, subjects, data, settings);
  const g = settings.grading;
  const L = settings.labels;

  return (
    <div className="space-y-4">
      <Tiles>
        <StatTile label="عدد الطلاب" value={students.length} sub={`${subjects.length} مادة`} info="الطلاب الفعّالون في هذا الصف. الطلاب الموقوفون لا يدخلون في الإحصائيات." />
        <StatTile label={cs.complete === students.length ? "المعدل العام للصف" : "المعدل العام حتى الآن"} value={cs.avgOverall ?? "—"} sub={`من ${g.scale} · ${cs.complete} من ${students.length} اكتمل معدلهم`} info="متوسط المعدل العام لكل طالب (المعدل العام = معدل علامات المواد حسب وزن كل مادة). قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط." />
        <StatTile label="نسبة النجاح" value={fmtPct(cs.passRate)} tone={cs.passRate !== null && cs.passRate < 50 ? "bad" : "good"} sub={`${cs.passed} من ${cs.graded}`}
          info={<>الطلاب الذين معدلهم العام ≥ {g.pass_mark}. الطلاب بـ NC لا يدخلون في النسبة.</>} />
        <StatTile label="نسبة الحضور" value={fmtPct(cs.attendance.attendanceRate)} sub={`${cs.attendance.absent + cs.attendance.excused} غياب في كل المواد`} info="كل تسجيلات الحضور في كل مواد الصف." />
        <StatTile label="يحتاجون متابعة" value={cs.atRisk.length} tone={cs.atRisk.length ? "warn" : "good"} sub="راجع القائمة أدناه"
          info={<>طالب معدله العام تحت {g.pass_mark}، أو راسب في مادة واحدة على الأقل، أو نسبة حضوره أقل من 80%.</>} />
      </Tiles>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="معدل كل مادة" info="متوسط العلامة النهائية في كل مادة. مرّر الفأرة على الشريط لرؤية نسبة النجاح.">
          <BarList max={g.scale} marker={{ value: g.pass_mark, label: `علامة النجاح (${g.pass_mark})` }}
            items={cs.perSubject.map(({ subject, stats }) => ({ key: subject.id, label: subject.name, value: stats.avgFinal, href: `/subject?id=${subject.id}`, color: subject.color, tip: `نسبة النجاح ${fmtPct(stats.passRate)}` }))} />
        </Section>
        <Section title="توزيع التقديرات (المعدل العام)" info="كل طالب حسب معدله العام على سلّم التقديرات.">
          <Distribution bands={cs.distribution} />
        </Section>
        <Section title="الترتيب" info="الطلاب حسب المعدل العام. التعادل يأخذ نفس الرتبة.">
          <RankList items={cs.ranked.slice(0, 10).map((r) => ({ key: r.student.id, label: r.student.full_name, value: r.value, href: studentHref(r.student.id), rank: cs.ranked.filter((x) => x.value > r.value).length + 1 }))} empty="لا توجد معدلات بعد." />
        </Section>
        <Section title="يحتاجون متابعة" info="مع سبب كل حالة. اضغط على الاسم لرؤية تفاصيل الطالب.">
          <RankList empty="لا يوجد 👍" items={cs.atRisk.slice(0, 12).map((p) => {
            const reasons: string[] = [];
            if (typeof p.overall === "number" && p.overall < g.pass_mark) reasons.push(`معدل ${p.overall}`);
            if (p.failing.length) reasons.push(`راسب في ${p.failing.map((x) => x.name).join("، ")}`);
            if (p.att.attendanceRate !== null && p.att.attendanceRate < 80) reasons.push(`حضور ${p.att.attendanceRate}%`);
            return { key: p.student.id, label: p.student.full_name, value: <span className="text-xs text-amber-700 dark:text-amber-400">{reasons.join(" · ")}</span>, href: studentHref(p.student.id) };
          })} />
        </Section>
        <Section title={`${L.participation} و${L.disruption} حسب المادة`} info="مجموع المشاركات والشغب في كل مادة، مع عدد الحصص المسجلة.">
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-500"><tr><th className="py-1 text-right font-medium">المادة</th><th className="font-medium">حصص مسجلة</th><th className="font-medium">{L.participation}</th><th className="font-medium">{L.disruption}</th><th className="font-medium">{L.late}</th></tr></thead>
            <tbody>
              {cs.perSubject.map(({ subject, stats }) => (
                <tr key={subject.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1.5">{subject.name}</td>
                  <td className="text-center tabular-nums">{stats.sessionsLogged}/{stats.sessionsPast}</td>
                  <td className="text-center tabular-nums">{stats.attendance.participation}</td>
                  <td className="text-center tabular-nums">{stats.attendance.disruption}</td>
                  <td className="text-center tabular-nums">{stats.attendance.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="ملخص الصف" info="أرقام سريعة عن الصف.">
          <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            <li>السنة الدراسية: <b>{cls.school_year ?? settings.year.school_year}</b></li>
            <li>طلاب اكتمل معدلهم النهائي: <b>{cs.complete}</b> من {students.length}</li>
            <li>طلاب لهم علامات حتى الآن: <b>{cs.graded}</b></li>
            <li>أعلى معدل: <b>{cs.ranked[0] ? `${fmt(cs.ranked[0].value)} — ${cs.ranked[0].student.full_name}` : "—"}</b></li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
