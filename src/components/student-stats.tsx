"use client";
// إحصائيات الطالب: نفس المكوّن في صفحة الأستاذ وفي رابط الطالب (حسب ما يسمح به الأستاذ).
import Link from "next/link";
import { useState } from "react";
import type { SubjectGrades } from "@/lib/class-data";
import { bandFor, fmt, type Result } from "@/lib/grades";
import { addAtt, attendance, avg, classStats, pct, rankOf, ranking, scoreOf, type Attendance } from "@/lib/stats";
import { addDays } from "@/lib/schedule";
import { overallPoints, subjectPoints, trendOf, weekKey, TREND_ARROW, TREND_LABEL, type Dates } from "@/lib/trajectory";
import type { Component, SubjectWeights } from "@/lib/settings";
import type { Student, Subject } from "@/lib/types";
import { BarList, Section, StatTile, Tiles, fmtPct } from "./charts";
import { StudentCompare } from "./compare-views";
import { Info } from "./info";
import { useSettings } from "./settings-provider";
import { TrajectoryChart, WeeklyBars, type LinePoint } from "./trajectory-chart";
import { Select, cx } from "./ui";

/** ما يظهر من الإحصائيات. في صفحة الأستاذ كله ظاهر، وفي رابط الطالب حسب الإعدادات ← ما يراه الطالب. */
export type StudentShow = {
  tiles: boolean;
  rank: boolean;
  classAvg: boolean;
  table: boolean;
  bars: boolean;
  attendance: boolean;
  trajectory: boolean;
  weekly: boolean;
  compare: boolean;
  band: boolean;
  /** أعمدة السعي ظاهرة؟ */
  components: Set<Component>;
};
export const SHOW_ALL: StudentShow = {
  tiles: true, rank: true, classAvg: true, table: true, bars: true, attendance: true, trajectory: true, weekly: true, compare: true, band: true,
  components: new Set(["p1", "p2", "m1", "pr1", "p3", "p4", "m2", "pr2"]),
};

type Props = {
  student: Student;
  /** طلاب الصف (للترتيب ومعدل الصف). في رابط الطالب: زملاء بدون أسماء، أو الطالب وحده. */
  pool: Student[];
  subjects: Subject[];
  data: Record<string, SubjectGrades>;
  dates: Record<string, Dates>;
  weights: Record<string, SubjectWeights>;
  show?: StudentShow;
  /** روابط إلى صفحات المواد (للأستاذ فقط) */
  links?: boolean;
};

export function StudentStatsBody({ student, pool, subjects, data, dates, weights, show = SHOW_ALL, links = false }: Props) {
  const { settings } = useSettings();
  const g = settings.grading;
  const L = settings.labels as Record<string, string>;
  const cs = classStats(pool, subjects, data, settings);
  const finalOverall = cs.finalOverall[student.id];
  const overall = cs.overall[student.id];
  const isSoFar = typeof finalOverall !== "number" && typeof overall === "number";
  const rank = rankOf(cs.ranked, student.id);
  const band = show.band ? bandFor(overall, settings) : null;
  const lowAtt = settings.alerts.low_attendance_rate;

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

  const cell = (v: Result) => (
    <span className={cx("tabular-nums", typeof v === "number" && v < g.pass_mark && "text-red-600", v === "NC" && "text-amber-600")}>{fmt(v) || "—"}</span>
  );
  const pr1 = show.components.has("pr1"), pr2 = show.components.has("pr2");
  const subjName = (sj: Subject) => links ? <Link href={`/subject?id=${sj.id}`} className="hover:text-brand-600 hover:underline">{sj.name}</Link> : sj.name;

  return (
    <div className="space-y-4">
      {show.tiles && (
        <Tiles>
          <StatTile label={isSoFar ? "المعدل العام حتى الآن" : "المعدل العام"} value={fmt(overall) || "—"} sub={band ? <span style={{ color: band.color }}>{band.label}{isSoFar ? " (حتى الآن)" : ""}</span> : `من ${g.scale}`}
            tone={typeof overall === "number" ? (overall >= g.pass_mark ? "good" : "bad") : undefined}
            info={<>معدل علامات «{L.final}» في كل المواد حسب وزن كل مادة. قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن»: نفس المعادلة لكن بالعلامات الموجودة فقط.</>} />
          {show.rank && <StatTile label="الترتيب في الصف" value={rank ? `${rank} / ${cs.ranked.length}` : "—"} info="الترتيب حسب المعدل العام بين الطلاب الذين لهم علامات. التعادل يأخذ نفس الرتبة." />}
          <StatTile label="نسبة الحضور" value={fmtPct(att.attendanceRate)} tone={att.attendanceRate !== null && att.attendanceRate < lowAtt ? "bad" : undefined}
            sub={`${att.absent} بدون عذر · ${att.excused} بعذر · ${att.late} ${L.late}`} info="في كل المواد: الحصص التي حضرها ÷ كل الحصص المسجلة له." />
          <StatTile label={`${L.participation} / ${L.disruption}`} value={`${att.participation} / ${att.disruption}`} info="المجموع في كل المواد والحصص المسجلة." />
          <StatTile label="الوظائف المنجزة" value={fmtPct(pct(att.hwDone, hwTotal))} sub={`${att.hwDone} منجزة · ${att.hwMissing} غير منجزة`} info="من تسجيل الوظيفة في الحصص ومن الواجبات (المتأخرة تُحسب منجزة)." />
        </Tiles>
      )}

      {show.table && (
        <Section title="العلامات في كل مادة" info={<>{show.rank ? "الترتيب = ترتيب الطالب في هذه المادة. " : ""}{show.classAvg ? <>معدل الصف = متوسط {L.final} لكل الطلاب في المادة.</> : null}</>}>
          <div className="table-scroll">
            <table className="sheet w-full min-w-[520px] text-sm">
              <thead>
                <tr>
                  <th className="sticky-c1 !w-auto min-w-[8rem] text-right">المادة</th>
                  <th>{L.sem1}</th><th>{L.sem2}</th>{pr1 && <th>{L.pr1}</th>}{pr2 && <th>{L.pr2}</th>}<th>{L.final}</th>
                  {show.rank && <th>الترتيب<Info title="الترتيب في المادة">بين الطلاب الذين لهم علامة في المادة.</Info></th>}
                  {show.classAvg && <th>معدل الصف</th>}
                  <th>الحضور</th>
                </tr>
              </thead>
              <tbody>
                {perSubject.map((p) => (
                  <tr key={p.sj.id}>
                    <td className="sticky-c1 !w-auto px-2 py-1.5">{subjName(p.sj)}</td>
                    <td className="text-center">{cell(p.row?.sem1 ?? null)}</td>
                    <td className="text-center">{cell(p.row?.sem2 ?? null)}</td>
                    {pr1 && <td className="text-center">{cell(p.row?.pr1 ?? null)}</td>}
                    {pr2 && <td className="text-center">{cell(p.row?.pr2 ?? null)}</td>}
                    <td className="text-center font-semibold">{cell(p.row?.final ?? null)}{p.row && typeof p.row.final !== "number" && p.row.current !== null && <div className="text-[11px] font-normal text-zinc-500">حتى الآن {p.row.current}</div>}</td>
                    {show.rank && <td className="text-center tabular-nums">{p.rank ? `${p.rank}/${p.of}` : "—"}</td>}
                    {show.classAvg && <td className="text-center tabular-nums text-zinc-500">{p.classAvg ?? "—"}</td>}
                    <td className="text-center tabular-nums">{fmtPct(p.att.attendanceRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {(show.bars || show.attendance) && (
        <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
          {show.bars && (
            <Section title={show.classAvg ? `${L.final} مقارنة بمعدل الصف` : `${L.final} في كل مادة`} info={`الشريط = علامة الطالب.${show.classAvg ? " مرّر الفأرة لرؤية معدل الصف في كل مادة." : ""} قبل اكتمال كل العلامات تُستعمل «العلامة حتى الآن».`}>
              <BarList max={g.scale} marker={{ value: g.pass_mark, label: `علامة النجاح (${g.pass_mark})` }}
                items={perSubject.map((p) => ({ key: p.sj.id, label: p.sj.name, value: scoreOf(p.row), display: typeof p.row?.final === "number" ? p.row.final : p.row?.current != null ? `${p.row.current} (حتى الآن)` : fmt(p.row?.final ?? null) || "—", color: p.sj.color, tip: show.classAvg ? `معدل الصف: ${p.classAvg ?? "—"}` : undefined }))} />
            </Section>
          )}
          {show.attendance && (
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
          )}
        </div>
      )}
      {(show.trajectory || show.weekly) && (
        <TrajectorySection student={student} pool={pool} subjects={subjects} data={data} dates={dates} weights={weights} show={show} />
      )}
      {show.compare && <StudentCompare student={student} subjects={subjects} data={data} />}
    </div>
  );
}

/** مسار الطالب عبر الوقت: علامات الامتحانات (لكل مادة أو كل المواد) + رسم صغير بالأسابيع. */
function TrajectorySection({ student, pool, subjects, data, dates, weights, show }: { student: Student; pool: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades>; dates: Record<string, Dates>; weights: Record<string, SubjectWeights>; show: StudentShow }) {
  const { settings } = useSettings();
  const L = settings.labels as Record<string, string>;
  const [sel, setSel] = useState<string>("all");
  const subj = subjects.find((x) => x.id === sel);
  let points: LinePoint[];
  if (subj) {
    const rows = Object.fromEntries(pool.map((p) => [p.id, data[subj.id]?.rows[p.id]]).filter(([, r]) => r));
    points = subjectPoints(student.id, rows, dates[subj.id] ?? {}, settings).map((p) => ({ key: p.comp, label: L[p.comp], date: p.date, score: p.score, classAvg: p.classAvg, drop: p.drop }));
  } else {
    const inp = subjects.map((sj) => ({ id: sj.id, name: sj.name, weight: Number(sj.weight), entries: data[sj.id]?.entries ?? {}, dates: dates[sj.id] ?? {}, weights: weights[sj.id] }));
    const name = new Map(subjects.map((x) => [x.id, x.name]));
    points = overallPoints(student.id, inp, settings).map((p) => ({ key: p.key, label: `${L[p.comp]} — ${name.get(p.subjectId) ?? ""}`, short: L[p.comp], date: p.date, score: p.score }));
  }
  const tr = trendOf(points.map((p) => p.score), settings);

  // الأسابيع: غياب، مشاركة، شغب
  const byWeek = new Map<string, { a: number; p: number; d: number }>();
  for (const sj of subjects) {
    const gr = data[sj.id];
    const live = new Map((gr?.sessions ?? []).filter((x) => !x.cancelled && !x.deleted_at).map((x) => [x.id, x.date]));
    for (const r of gr?.records ?? []) {
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
  if (keys.length) for (let k = keys[0]; k <= keys[keys.length - 1] && weeks.length < 60; k = addDays(k, 7)) weeks.push(k);
  const series = (f: (w: { a: number; p: number; d: number }) => number) => weeks.map((w) => f(byWeek.get(w) ?? { a: 0, p: 0, d: 0 }));

  return (
    <div className={cx("grid gap-4", show.trajectory && show.weekly && "lg:grid-cols-[2fr_1fr] print:grid-cols-[2fr_1fr]")}>
      {show.trajectory && (
        <Section title="مسار العلامات" info={`النقاط = علامات الامتحانات من ${settings.grading.scale} حسب التاريخ (بدون تاريخ يُستعمل الترتيب الطبيعي).${show.classAvg ? " الخط الرمادي = معدل الصف في نفس الامتحان." : ""} النقطة الحمراء = هبوط مفاجئ. «كل المواد» = المعدل العام حتى الآن بعد كل امتحان.`}
          actions={
            <div className="flex items-center gap-2">
              {tr && <span className={cx("text-sm font-medium", tr === "up" ? "text-green-700 dark:text-green-400" : tr === "down" ? "text-red-600" : "text-zinc-500")}>{TREND_ARROW[tr]} {TREND_LABEL[tr]}</span>}
              <Select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="المادة" className="no-print">
                <option value="all">كل المواد</option>
                {subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <span className="hidden text-sm print:inline">{subj?.name ?? "كل المواد"}</span>
            </div>
          }>
          <TrajectoryChart points={points} max={settings.grading.scale} pass={settings.grading.pass_mark} showClass={!!subj && show.classAvg} />
        </Section>
      )}
      {show.weekly && (
        <Section title="كل أسبوع" info="الغياب والمشاركة والشغب في كل أسبوع (كل المواد).">
          <WeeklyBars weeks={weeks} rows={[
            { label: L.absent, values: series((w) => w.a), tone: "bad" },
            { label: L.participation, values: series((w) => w.p) },
            { label: L.disruption, values: series((w) => w.d), tone: "bad" },
          ]} />
        </Section>
      )}
    </div>
  );
}
