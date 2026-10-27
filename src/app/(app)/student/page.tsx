"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassFull, type SubjectGrades } from "@/lib/class-data";
import { absoluteUrl } from "@/lib/paths";
import { bandFor, fmt, type Result } from "@/lib/grades";
import { addAtt, attendance, classStats, rankOf, ranking, avg, num, pct, scoreOf, type Attendance } from "@/lib/stats";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { BarList, Section, StatTile, Tiles, fmtPct } from "@/components/charts";
import { Info } from "@/components/info";
import { Button, Card, Empty, PageHeader, Spinner, cx, useToast } from "@/components/ui";

export default function StudentPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <StudentView key={id} id={id} />;
}

type Loaded = { student: Student; cls: ClassRow; students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades> };

function StudentView({ id }: { id: string }) {
  const { settings, loaded, subjectWeights } = useSettings();
  const toast = useToast();
  const [d, setD] = useState<Loaded | null | undefined>(undefined);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const { data: st } = await supabase().from("students").select("*").eq("id", id).maybeSingle();
      if (!st) return setD(null);
      const full = await loadClassFull(st.class_id, settings, subjectWeights);
      if (!full.cls) return setD(null);
      setD({ student: st as Student, cls: full.cls, students: full.students, subjects: full.subjects, data: full.data });
    })();
  }, [id, loaded, settings, subjectWeights]);

  if (d === undefined) return <Spinner />;
  if (d === null) return <Empty>الطالب غير موجود.</Empty>;

  const { student, cls, students, subjects, data } = d;
  const g = settings.grading;
  const L = settings.labels as Record<string, string>;
  const pool = students.some((s) => s.id === student.id) ? students : [...students, student];
  const cs = classStats(pool, subjects, data, settings);
  const finalOverall = cs.finalOverall[student.id];
  const overall = cs.overall[student.id];
  const isSoFar = typeof finalOverall !== "number" && typeof overall === "number";
  const rank = rankOf(cs.ranked, student.id);
  const band = bandFor(overall, settings);

  let att: Attendance = attendance(undefined);
  for (const sj of subjects) att = addAtt(att, attendance(data[sj.id], student.id));
  const hwTotal = att.hwDone + att.hwMissing;

  const perSubject = subjects.map((sj) => {
    const row = data[sj.id]?.rows[student.id];
    const ranked = ranking(pool, (s) => scoreOf(data[sj.id]?.rows[s.id]));
    return {
      sj, row,
      rank: rankOf(ranked, student.id), of: ranked.length,
      classAvg: avg(pool.map((s) => scoreOf(data[sj.id]?.rows[s.id]))),
      att: attendance(data[sj.id], student.id),
    };
  });

  async function copyLink() {
    await navigator.clipboard.writeText(absoluteUrl(`/s/?t=${student.share_token}`));
    toast({ text: "تم نسخ رابط الطالب", kind: "ok" });
  }

  const cell = (v: Result) => (
    <span className={cx("tabular-nums", typeof v === "number" && v < g.pass_mark && "text-red-600", v === "NC" && "text-amber-600")}>{fmt(v) || "—"}</span>
  );

  return (
    <div>
      <div className="mb-2 text-sm text-zinc-500">
        <Link href="/" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${cls.id}`} className="hover:underline">{cls.name}</Link> ‹ {student.full_name}
      </div>
      <PageHeader title={student.full_name} sub={<>{cls.name}{student.student_number && ` · رقم ${student.student_number}`}{!student.active && " · غير فعّال"}</>}
        actions={student.share_enabled ? (
          <>
            <Button variant="secondary" onClick={copyLink}>نسخ رابط الطالب</Button>
            <a href={absoluteUrl(`/s/?t=${student.share_token}`)} target="_blank" rel="noreferrer"><Button variant="secondary">الصفحة كما يراها الطالب</Button></a>
          </>
        ) : undefined} />

      <div className="space-y-4">
        <Tiles>
          <StatTile label={isSoFar ? "المعدل العام حتى الآن" : "المعدل العام"} value={fmt(overall) || "—"} sub={band ? <span style={{ color: band.color }}>{band.label}{isSoFar ? " (حتى الآن)" : ""}</span> : `من ${g.scale}`}
            tone={typeof overall === "number" ? (overall >= g.pass_mark ? "good" : "bad") : undefined}
            info={<>معدل علامات «{L.final}» في كل المواد حسب وزن كل مادة. قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط.</>} />
          <StatTile label="الترتيب في الصف" value={rank ? `${rank} / ${cs.ranked.length}` : "—"} info="ترتيب الطالب حسب المعدل العام بين الطلاب الذين لهم معدل كامل. التعادل يأخذ نفس الرتبة." />
          <StatTile label="نسبة الحضور" value={fmtPct(att.attendanceRate)} tone={att.attendanceRate !== null && att.attendanceRate < 80 ? "bad" : undefined}
            sub={`${att.absent} بدون عذر · ${att.excused} بعذر · ${att.late} ${L.late}`} info="في كل المواد: الحصص التي حضرها ÷ كل الحصص المسجلة له." />
          <StatTile label={`${L.participation} / ${L.disruption}`} value={`${att.participation} / ${att.disruption}`} info="المجموع في كل المواد والحصص المسجلة." />
          <StatTile label="الوظائف المنجزة" value={fmtPct(pct(att.hwDone, hwTotal))} sub={`${att.hwDone} منجزة · ${att.hwMissing} غير منجزة`} info="من تسجيل الوظيفة في الحصص ومن تبويب الواجبات (المتأخرة تُحسب منجزة)." />
        </Tiles>

        <Section title="العلامات في كل مادة" info={<>الترتيب = ترتيب الطالب في هذه المادة. معدل الصف = متوسط {L.final} لكل الطلاب في المادة.</>}>
          <div className="table-scroll">
            <table className="sheet w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="sticky-c1 !w-auto min-w-[8rem] text-right">المادة</th>
                  <th>{L.sem1}</th><th>{L.sem2}</th><th>{L.pr1}</th><th>{L.pr2}</th><th>{L.final}</th>
                  <th>الترتيب<Info title="الترتيب في المادة">بين الطلاب الذين لهم علامة نهائية كاملة في المادة.</Info></th>
                  <th>معدل الصف</th><th>الحضور</th>
                </tr>
              </thead>
              <tbody>
                {perSubject.map((p) => (
                  <tr key={p.sj.id}>
                    <td className="sticky-c1 !w-auto px-2 py-1.5"><Link href={`/subject?id=${p.sj.id}`} className="hover:text-brand-600 hover:underline">{p.sj.name}</Link></td>
                    <td className="text-center">{cell(p.row?.sem1 ?? null)}</td>
                    <td className="text-center">{cell(p.row?.sem2 ?? null)}</td>
                    <td className="text-center">{cell(p.row?.pr1 ?? null)}</td>
                    <td className="text-center">{cell(p.row?.pr2 ?? null)}</td>
                    <td className="text-center font-semibold">{cell(p.row?.final ?? null)}{p.row && typeof p.row.final !== "number" && p.row.current !== null && <div className="text-[11px] font-normal text-zinc-500">حتى الآن {p.row.current}</div>}</td>
                    <td className="text-center tabular-nums">{p.rank ? `${p.rank}/${p.of}` : "—"}</td>
                    <td className="text-center tabular-nums text-zinc-500">{p.classAvg ?? "—"}</td>
                    <td className="text-center tabular-nums">{fmtPct(p.att.attendanceRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={`${L.final} مقارنة بمعدل الصف`} info="الشريط = علامة الطالب. مرّر الفأرة لرؤية معدل الصف في كل مادة. قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط.">
            <BarList max={g.scale} marker={{ value: g.pass_mark, label: `علامة النجاح (${g.pass_mark})` }}
              items={perSubject.map((p) => ({ key: p.sj.id, label: p.sj.name, value: scoreOf(p.row), display: typeof p.row?.final === "number" ? p.row.final : p.row?.current != null ? `${p.row.current} (حتى الآن)` : fmt(p.row?.final ?? null) || "—", color: p.sj.color, tip: `معدل الصف: ${p.classAvg ?? "—"}` }))} />
          </Section>
          <Section title="الحضور والسلوك حسب المادة" info="من تسجيل الحصص في كل مادة.">
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-500"><tr>
                <th className="py-1 text-right font-medium">المادة</th><th className="font-medium">{L.absent}</th><th className="font-medium">{L.late}</th>
                <th className="font-medium">{L.participation}</th><th className="font-medium">{L.disruption}</th><th className="font-medium">{L.homework}</th>
              </tr></thead>
              <tbody>
                {perSubject.map((p) => (
                  <tr key={p.sj.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5">{p.sj.name}</td>
                    <td className="text-center tabular-nums">{p.att.absent + p.att.excused}{p.att.excused ? <span className="text-xs text-zinc-400"> ({p.att.excused} بعذر)</span> : null}</td>
                    <td className="text-center tabular-nums">{p.att.late}</td>
                    <td className="text-center tabular-nums">{p.att.participation}</td>
                    <td className="text-center tabular-nums">{p.att.disruption}</td>
                    <td className="text-center tabular-nums">{p.att.hwDone}/{p.att.hwDone + p.att.hwMissing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </div>
        {student.notes && <Card><div className="text-sm"><b>ملاحظات:</b> {student.notes}</div></Card>}
      </div>
    </div>
  );
}
