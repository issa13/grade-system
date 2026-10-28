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
import { WhatsAppQueue } from "@/components/whatsapp";
import { StudentCompare } from "@/components/compare-views";
import { TrajectoryChart, WeeklyBars, type LinePoint } from "@/components/trajectory-chart";
import { overallPoints, overallTrend, subjectPoints, trendOf, weekKey, TREND_ARROW, TREND_LABEL, type Dates, type Exam } from "@/lib/trajectory";
import { addDays } from "@/lib/schedule";
import { Select } from "@/components/ui";
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

type Loaded = { student: Student; cls: ClassRow; students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades>; dates: Record<string, Dates> };

function StudentView({ id }: { id: string }) {
  const { settings, loaded, subjectWeights } = useSettings();
  const toast = useToast();
  const [d, setD] = useState<Loaded | null | undefined>(undefined);
  const [wa, setWa] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const { data: st } = await supabase().from("students").select("*").eq("id", id).maybeSingle();
      if (!st) return setD(null);
      const full = await loadClassFull(st.class_id, settings, subjectWeights);
      if (!full.cls) return setD(null);
      const { data: ad } = await supabase().from("assessment_dates").select("subject_id,component,date").in("subject_id", full.subjects.map((x) => x.id));
      const dates: Record<string, Dates> = {};
      for (const x of (ad ?? []) as { subject_id: string; component: Exam; date: string }[]) (dates[x.subject_id] ??= {})[x.component] = x.date;
      setD({ student: st as Student, cls: full.cls, students: full.students, subjects: full.subjects, data: full.data, dates });
    })();
  }, [id, loaded, settings, subjectWeights]);

  if (d === undefined) return <Spinner />;
  if (d === null) return <Empty>الطالب غير موجود.</Empty>;

  const { student, cls, students, subjects, data, dates } = d;
  const g = settings.grading;
  const L = settings.labels as Record<string, string>;
  const pool = students.some((s) => s.id === student.id) ? students : [...students, student];
  const cs = classStats(pool, subjects, data, settings);
  const finalOverall = cs.finalOverall[student.id];
  const overall = cs.overall[student.id];
  const isSoFar = typeof finalOverall !== "number" && typeof overall === "number";
  const rank = rankOf(cs.ranked, student.id);
  const band = bandFor(overall, settings);
  const trend = overallTrend(student.id, subjects.map((sj) => ({ id: sj.id, name: sj.name, weight: Number(sj.weight), entries: data[sj.id]?.entries ?? {}, dates: dates[sj.id] ?? {}, weights: subjectWeights[sj.id] })), settings);

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
        <Link href="/classes" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${cls.id}`} className="hover:underline">{cls.name}</Link> ‹ {student.full_name}
      </div>
      <PageHeader title={<>{student.full_name}{trend && <span className={cx("ms-2 text-base font-medium", trend === "up" ? "text-green-700 dark:text-green-400" : trend === "down" ? "text-red-600" : "text-zinc-500")} title={`الاتجاه: ${TREND_LABEL[trend]}`}>{TREND_ARROW[trend]} {TREND_LABEL[trend]}</span>}</>}
        sub={<>{cls.name}{student.student_number && ` · رقم ${student.student_number}`}{!student.active && " · غير فعّال"}</>}
        actions={
          <>
            <Button variant="secondary" onClick={() => setWa(true)}>رسالة واتساب</Button>
            <Link href={`/report?class=${cls.id}&student=${student.id}`}><Button variant="secondary">تقرير PDF</Button></Link>
            {student.share_enabled && <>
              <Button variant="secondary" onClick={copyLink}>نسخ رابط الطالب</Button>
              <a href={absoluteUrl(`/s/?t=${student.share_token}`)} target="_blank" rel="noreferrer"><Button variant="secondary">الصفحة كما يراها الطالب</Button></a>
            </>}
          </>
        } />
      {wa && <WhatsAppQueue students={[student]} classId={cls.id} onClose={() => setWa(false)} />}

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
        <TrajectorySection student={student} pool={pool} subjects={subjects} data={data} dates={dates} />
        <StudentCompare student={student} subjects={subjects} data={data} />
        {student.notes && <Card><div className="text-sm"><b>ملاحظات:</b> {student.notes}</div></Card>}
      </div>
    </div>
  );
}

/** مسار الطالب عبر الوقت: علامات الامتحانات (لكل مادة أو كل المواد) + رسم صغير بالأسابيع. */
function TrajectorySection({ student, pool, subjects, data, dates }: { student: Student; pool: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades>; dates: Record<string, Dates> }) {
  const { settings, subjectWeights } = useSettings();
  const L = settings.labels as Record<string, string>;
  const [sel, setSel] = useState<string>("all");
  const subj = subjects.find((x) => x.id === sel);
  let points: LinePoint[];
  if (subj) {
    const rows = Object.fromEntries(pool.map((p) => [p.id, data[subj.id]?.rows[p.id]]).filter(([, r]) => r));
    points = subjectPoints(student.id, rows, dates[subj.id] ?? {}, settings).map((p) => ({ key: p.comp, label: L[p.comp], date: p.date, score: p.score, classAvg: p.classAvg, drop: p.drop }));
  } else {
    const inp = subjects.map((sj) => ({ id: sj.id, name: sj.name, weight: Number(sj.weight), entries: data[sj.id]?.entries ?? {}, dates: dates[sj.id] ?? {}, weights: subjectWeights[sj.id] }));
    const name = new Map(subjects.map((x) => [x.id, x.name]));
    points = overallPoints(student.id, inp, settings).map((p) => ({ key: p.key, label: `${L[p.comp]} — ${name.get(p.subjectId) ?? ""}`, short: L[p.comp], date: p.date, score: p.score }));
  }
  const tr = trendOf(points.map((p) => p.score), settings);

  // الأسابيع: غياب، مشاركة، شغب
  const byWeek = new Map<string, { a: number; p: number; d: number }>();
  for (const sj of subjects) {
    const g = data[sj.id];
    const live = new Map((g?.sessions ?? []).filter((x) => !x.cancelled && !x.deleted_at).map((x) => [x.id, x.date]));
    for (const r of g?.records ?? []) {
      if (r.student_id !== student.id || !live.has(r.session_id)) continue;
      const k = weekKey(live.get(r.session_id)!);
      const w = byWeek.get(k) ?? { a: 0, p: 0, d: 0 };
      if (r.absence) w.a++;
      w.p += r.participation; w.d += r.disruption;
      byWeek.set(k, w);
    }
  }
  const keys = [...byWeek.keys()].sort();
  const weeks: string[] = [];
  if (keys.length) for (let k = keys[0]; k <= keys[keys.length - 1]; k = addDays(k, 7)) weeks.push(k);
  const series = (f: (w: { a: number; p: number; d: number }) => number) => weeks.map((w) => f(byWeek.get(w) ?? { a: 0, p: 0, d: 0 }));

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <Section title="مسار العلامات" info="النقاط = علامات الامتحانات من 20 حسب التاريخ (تاريخ الامتحان يُضاف من رأس العمود في كشف العلامات، وبدونه يُستعمل الترتيب الطبيعي). الخط الرمادي = معدل الصف في نفس الامتحان. النقطة الحمراء = هبوط مفاجئ. «كل المواد» = المعدل العام حتى الآن بعد كل امتحان."
        actions={
          <div className="flex items-center gap-2">
            {tr && <span className={cx("text-sm font-medium", tr === "up" ? "text-green-700 dark:text-green-400" : tr === "down" ? "text-red-600" : "text-zinc-500")}>{TREND_ARROW[tr]} {TREND_LABEL[tr]}</span>}
            <Select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="المادة">
              <option value="all">كل المواد</option>
              {subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </div>
        }>
        <TrajectoryChart points={points} max={settings.grading.scale} pass={settings.grading.pass_mark} showClass={!!subj} />
      </Section>
      <Section title="كل أسبوع" info="الغياب والمشاركة والشغب في كل أسبوع (كل المواد).">
        <WeeklyBars weeks={weeks} rows={[
          { label: L.absent, values: series((w) => w.a), tone: "bad" },
          { label: L.participation, values: series((w) => w.p) },
          { label: L.disruption, values: series((w) => w.d), tone: "bad" },
        ]} />
      </Section>
    </div>
  );
}
