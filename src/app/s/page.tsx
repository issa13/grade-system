"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { aggregateFromReport } from "@/lib/behavior";
import { bandFor, computeRow, fmt, overallAverage, type BehaviorAgg, type Entries, type GradeRow } from "@/lib/grades";
import { mergeSettings, type Component, type Settings } from "@/lib/settings";
import { cx } from "@/components/ui";

type Report = {
  student: { name: string; number: string | null; class_name: string; school_year: string | null };
  settings: Record<string, unknown>;
  subjects: { id: string; name: string; color: string; weight: number }[];
  entries: { subject_id: string; component: Component; score: number | null; excused: boolean }[];
  behavior: (BehaviorAgg & { subject_id: string; semester: 1 | 2 })[];
  assignments: { subject_id: string; semester: 1 | 2; done: number; late: number; missing: number }[];
};

export default function StudentReport() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const token = useSearchParams().get("t") ?? "";
  return <StudentReportView key={token} token={token} />;
}

function StudentReportView({ token }: { token: string }) {
  const [rep, setRep] = useState<Report | null | undefined>(undefined);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [flash, setFlash] = useState(false);

  const load = useCallback(async (live = false) => {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return setRep(null);
    const { data, error } = await supabase().rpc("get_student_report", { p_token: token });
    if (error) return setRep(null);
    setRep((data as Report) ?? null);
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

  if (rep === undefined) return <div className="flex min-h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  if (rep === null) return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div><div className="mb-2 text-4xl">🔒</div><h1 className="text-xl font-bold">الرابط غير صالح</h1><p className="mt-1 text-zinc-500">قد يكون الأستاذ قد جدّد الرابط أو عطّله.</p></div>
    </main>
  );

  const s: Settings = mergeSettings(rep.settings);
  const V = s.visibility;
  const L = s.labels as Record<string, string>;
  const aggs = aggregateFromReport(rep.behavior, rep.assignments);
  const rows: Record<string, GradeRow> = {};
  for (const sj of rep.subjects) {
    const en: Entries = {};
    rep.entries.filter((e) => e.subject_id === sj.id).forEach((e) => (en[e.component] = { score: e.score === null ? null : Number(e.score), excused: e.excused }));
    rows[sj.id] = computeRow(en, s, aggs[sj.id]);
  }
  const overall = overallAverage(rep.subjects.map((sj) => ({ final: rows[sj.id].final, weight: Number(sj.weight) })), s);
  const band = bandFor(overall, s);
  const vis = new Set(V.components);
  const sem1Cols = (["p1", "p2", "m1", "pr1"] as Component[]).filter((c) => vis.has(c));
  const sem2Cols = (["p3", "p4", "m2", "pr2"] as Component[]).filter((c) => vis.has(c));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          {s.profile.school_name && <div className="text-sm text-zinc-500">{s.profile.school_name}</div>}
          <h1 className="text-2xl font-bold">{rep.student.name}</h1>
          <div className="text-sm text-zinc-500">{rep.student.class_name} · {rep.student.school_year ?? s.year.school_year}</div>
        </div>
        {s.profile.logo_url && <img src={s.profile.logo_url} alt="" className="h-14 w-14 rounded-lg object-contain" />}
      </header>

      {V.show_overall && (
        <div className={cx("mb-6 rounded-2xl bg-brand-500 p-5 text-white transition", flash && "ring-4 ring-amber-300")}>
          <div className="text-sm opacity-80">المعدل العام</div>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold tabular-nums">{fmt(overall) || "—"}</span>
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
                {V.show_final && <span className="text-lg font-bold tabular-nums">{fmt(r.final) || "—"}</span>}
                {V.show_band && b && <span className="text-xs" style={{ color: b.color }}>{b.label}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[{ title: "الفصل الأول", cols: sem1Cols, sem: r.sem1, k: "sem1" }, { title: "الفصل الثاني", cols: sem2Cols, sem: r.sem2, k: "sem2" }].map((x) => (
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

      <footer className="mt-6 flex items-center justify-between text-xs text-zinc-400">
        <span>NC = غير مكتمل · تتحدّث الصفحة تلقائياً{updated && ` · آخر تحديث ${updated.toLocaleTimeString("ar-LB")}`}</span>
        <button className="no-print rounded-lg border border-zinc-300 px-3 py-1 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300" onClick={() => window.print()}>طباعة / PDF</button>
      </footer>
    </main>
  );
}
