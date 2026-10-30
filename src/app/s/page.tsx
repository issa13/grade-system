"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { aggregateFromReport } from "@/lib/behavior";
import { bandFor, fmt, overallAverage, type BehaviorAgg, type GradeRow } from "@/lib/grades";
import { mergeSettings, type Component, type Settings } from "@/lib/settings";
import { buildStudentReport, ME, type Report } from "@/lib/student-report";
import { classStats } from "@/lib/stats";
import { cx } from "@/components/ui";
import { StaticSettingsProvider } from "@/components/settings-provider";
import { StudentStatsBody, type StudentShow } from "@/components/student-stats";
import { printPage } from "@/components/print";
import { normalizePhone } from "@/lib/whatsapp";

export default function StudentReport() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const token = useSearchParams().get("t") ?? "";
  return <StudentReportView key={token} token={token} />;
}

function StudentReportView({ token }: { token: string }) {
  const [rep, setRep] = useState<Report | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [flash, setFlash] = useState(false);

  const load = useCallback(async (live = false) => {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return setRep(null);
    try {
      const { data, error } = await supabase().rpc("get_student_report", { p_token: token });
      // خطأ في الشبكة ≠ رابط غير صالح: نبقي آخر نسخة معروضة
      if (error) { setFailed(true); return; }
      setFailed(false);
      setRep((data as Report) ?? null);
    } catch {
      setFailed(true);
      return;
    }
    setUpdated(new Date());
    if (live) { setFlash(true); setTimeout(() => setFlash(false), 1500); }
  }, [token]);

  useEffect(() => {
    load();
    const ch = supabase().channel(`report:${token}`).on("broadcast", { event: "changed" }, () => load(true)).subscribe();
    const poll = setInterval(() => load(), 60_000);
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    return () => { supabase().removeChannel(ch); clearInterval(poll); document.removeEventListener("visibilitychange", vis); };
  }, [load, token]);

  if (rep === undefined && failed) return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div><div className="mb-2 text-4xl">📶</div><h1 className="text-xl font-bold">تعذّر التحميل</h1><p className="mt-1 text-zinc-500">تأكد من الاتصال بالإنترنت.</p>
        <button className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-sm text-white" onClick={() => load()}>إعادة المحاولة</button></div>
    </main>
  );
  if (rep === undefined) return <div className="flex min-h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  if (rep === null) return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div><div className="mb-2 text-4xl">🔒</div><h1 className="text-xl font-bold">الرابط غير صالح</h1><p className="mt-1 text-zinc-500">قد يكون الأستاذ قد جدّد الرابط أو عطّله.</p></div>
    </main>
  );

  const s: Settings = mergeSettings(rep.settings);
  const V = s.visibility;
  const L = s.labels as Record<string, string>;
  const aggs = aggregateFromReport(rep.behavior ?? [], rep.assignments ?? []);
  const built = buildStudentReport(rep, s);
  const rows: Record<string, GradeRow> = {};
  for (const sj of rep.subjects) rows[sj.id] = built.data[sj.id].rows[ME];
  const vset = new Set(V.components);
  const show: StudentShow = {
    tiles: V.show_stats_tiles, rank: V.show_class_rank && built.pool.length > 1, classAvg: V.show_class_avg && built.pool.length > 1,
    table: V.show_stats_table, bars: V.show_bars, attendance: V.show_attendance, trajectory: V.show_trajectory,
    weekly: V.show_weekly, compare: V.show_compare, band: V.show_band, components: vset,
  };
  const anyStats = show.tiles || show.table || show.bars || show.attendance || show.trajectory || show.weekly || show.compare;
  const finalOverall = overallAverage(rep.subjects.map((sj) => ({ final: rows[sj.id].final, weight: Number(sj.weight) })), s);
  // مثل صفحة الأستاذ: قبل اكتمال العلامات نعرض «حتى الآن» بدل NC
  const soFar = classStats(built.pool, built.subjects, built.data, s).overall[ME];
  const overall = typeof finalOverall === "number" ? finalOverall : typeof soFar === "number" ? soFar : finalOverall;
  const overallSoFar = typeof finalOverall !== "number" && typeof soFar === "number";
  const band = bandFor(overall, s);
  const vis = new Set(V.components);
  const sem1Cols = (["p1", "p2", "m1", "pr1"] as Component[]).filter((c) => vis.has(c));
  const sem2Cols = (["p3", "p4", "m2", "pr2"] as Component[]).filter((c) => vis.has(c));

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          {s.profile.school_name && <div className="text-sm text-zinc-500">{s.profile.school_name}</div>}
          <h1 className="text-2xl font-bold">{rep.student.name}</h1>
          <div className="text-sm text-zinc-500">{rep.student.class_name} · {rep.student.school_year ?? s.year.school_year}</div>
        </div>
        {(s.report_images.logo || s.profile.logo_url) && <img src={s.report_images.logo || s.profile.logo_url} alt="" className="h-14 w-14 rounded-lg object-contain" />}
      </header>

      {V.show_overall && (
        <div className={cx("mb-6 rounded-2xl bg-brand-500 p-5 text-white transition", flash && "ring-4 ring-amber-300")}>
          <div className="text-sm opacity-80">المعدل العام</div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold tabular-nums">{fmt(overall) || "—"}</span>
            {overallSoFar && <span className="text-sm opacity-80">حتى الآن</span>}
            {typeof overall === "number" && <span className="opacity-80">/ {s.grading.scale}</span>}
            {V.show_band && band && <span className="ms-auto rounded-full bg-white/20 px-3 py-1 text-sm">{band.label}</span>}
          </div>
        </div>
      )}

      <div className="space-y-4">
        {rep.subjects.map((sj) => {
          const r = rows[sj.id];
          const b = bandFor(r.final, s);
          const ag = aggs[sj.id];
          return (
            <section key={sj.id} className={cx("rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900", flash && "ring-2 ring-amber-300")}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-5 w-1.5 rounded-full" style={{ background: sj.color }} />
                <h2 className="flex-1 font-semibold">{sj.name}</h2>
                {V.show_final && <span className="text-lg font-bold tabular-nums">{typeof r.final !== "number" && r.current !== null ? <>{r.current}<span className="ms-1 text-xs font-normal text-zinc-500">حتى الآن</span></> : fmt(r.final) || "—"}</span>}
                {V.show_band && b && <span className="text-xs" style={{ color: b.color }}>{b.label}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[{ title: L.term1, cols: sem1Cols, sem: r.sem1, k: "sem1" }, { title: L.term2, cols: sem2Cols, sem: r.sem2, k: "sem2" }].map((x) => (
                  <div key={x.k} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
                    <div className="mb-2 text-xs font-medium text-zinc-500">{x.title}</div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      {x.cols.map((c) => (
                        <div key={c} className="contents">
                          <dt className="text-zinc-500">{L[c]}</dt>
                          <dd className="text-left tabular-nums">{fmt(r[c]) || "—"}</dd>
                        </div>
                      ))}
                      {V.show_semesters && (
                        <><dt className="font-medium">{L[x.k]}</dt><dd className="text-left font-semibold tabular-nums">{fmt(x.sem) || "—"}</dd></>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
              {V.show_behavior && ag && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                  {(() => {
                    const t: BehaviorAgg = {};
                    for (const v of [ag[1], ag[2]]) if (v) for (const k of Object.keys(v) as (keyof BehaviorAgg)[]) t[k] = (t[k] ?? 0) + Number(v[k] ?? 0);
                    return (
                      <>
                        <span>{L.participation}: {t.participation ?? 0}</span>
                        <span>{L.disruption}: {t.disruption ?? 0}</span>
                        <span>{L.late}: {t.late ?? 0}</span>
                        <span>{L.absent}: {(t.absent_unexcused ?? 0) + (t.absent_excused ?? 0)}{t.absent_excused ? ` (${t.absent_excused} ${L.excused})` : ""}</span>
                        <span>{L.homework}: {t.hw_done ?? 0} {L.hw_done} / {t.hw_missing ?? 0} {L.hw_missing}</span>
                      </>
                    );
                  })()}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {anyStats && (
        <StaticSettingsProvider settings={s}>
          <h2 className="mb-3 mt-8 text-lg font-bold">الإحصائيات</h2>
          <StudentStatsBody student={built.me} pool={built.pool} subjects={built.subjects} data={built.data} dates={built.dates} weights={built.weights} show={show} />
        </StaticSettingsProvider>
      )}

      {!rep.student.phone_set && <SendPhone token={token} pending={!!rep.student.phone_pending} countryCode={s.whatsapp.country_code} />}

      <footer className="mt-6 flex items-center justify-between text-xs text-zinc-400">
        <span>NC = غير مكتمل · تتحدّث الصفحة تلقائياً{updated && ` · آخر تحديث ${updated.toLocaleTimeString("ar-LB")}`}{failed && " · بدون اتصال الآن"}</span>
        {V.allow_pdf && <button className="no-print rounded-lg border border-zinc-300 px-3 py-1 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300" onClick={() => printPage(`علامات ${rep.student.name}`)}>⤓ تحميل PDF</button>}
      </footer>
    </main>
  );
}

/** «أرسل رقمك»: الطالب يكتب رقمه بنفسه، ويظهر للأستاذ للموافقة. */
function SendPhone({ token, pending, countryCode }: { token: string; pending: boolean; countryCode: string }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [state, setState] = useState<"idle" | "sent" | "bad" | "err">(pending ? "sent" : "idle");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const n = normalizePhone(val, countryCode);
    if (!n) return setState("bad");
    const { data, error } = await supabase().rpc("submit_phone", { p_token: token, p_phone: n });
    setState(error || data === false ? "err" : "sent");
  }
  if (state === "sent") return <p className="no-print mt-6 rounded-lg bg-green-50 p-3 text-center text-sm text-green-800 dark:bg-green-950/40 dark:text-green-300">✓ وصل رقمك إلى الأستاذ، بانتظار موافقته.</p>;
  return (
    <div className="no-print mt-6 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      {!open ? (
        <button className="text-brand-600 hover:underline" onClick={() => setOpen(true)}>أرسل رقمك</button>
      ) : (
        <form onSubmit={send} className="space-y-2">
          <p className="text-zinc-600 dark:text-zinc-300">اكتب رقم هاتفك (واتساب) حتى يرسل لك الأستاذ ملخصك الأسبوعي. لا يظهر رقمك في هذه الصفحة.</p>
          <div className="flex gap-2">
            <input dir="ltr" inputMode="tel" required value={val} onChange={(e) => { setVal(e.target.value); setState("idle"); }} placeholder="03 123 456"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
            <button className="rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600">إرسال</button>
          </div>
          {state === "bad" && <p className="text-xs text-red-600">الرقم غير صالح.</p>}
          {state === "err" && <p className="text-xs text-red-600">تعذّر الإرسال، حاول لاحقاً.</p>}
        </form>
      )}
    </div>
  );
}
