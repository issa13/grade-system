"use client";
import { useState } from "react";
import { fmtDate } from "@/lib/dates";
import { cx } from "./ui";

export type LinePoint = { key: string; label: string; short?: string; date: string | null; score: number; classAvg?: number | null; drop?: boolean };

/**
 * مسار العلامات: خط الطالب، خط رمادي لمعدل الصف، وخط أفقي لعلامة النجاح.
 * الهبوط المفاجئ نقطة حمراء. المرور على نقطة يعرض الامتحان والتاريخ والعلامة ومعدل الصف.
 */
export function TrajectoryChart({ points, max, pass, showClass = true }: { points: LinePoint[]; max: number; pass: number; showClass?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <p className="py-6 text-center text-sm text-zinc-500">لا توجد علامات امتحانات بعد.</p>;
  const W = 640, H = 230, L = 34, R = 16, T = 14, B = 44;
  const iw = W - L - R, ih = H - T - B;
  const x = (i: number) => L + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => T + ih - (Math.max(0, Math.min(max, v)) / max) * ih;
  const ticks = [0, max / 4, max / 2, (3 * max) / 4, max];
  const path = (vals: (number | null | undefined)[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v === null || v === undefined) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const hasClass = showClass && points.some((p) => p.classAvg !== null && p.classAvg !== undefined);
  const hp = hover !== null ? points[hover] : null;
  // أسماء المحور: إذا كثرت النقاط نكتب بعضها فقط (الباقي عند المرور)
  const every = Math.max(1, Math.ceil(points.length / 7));
  const showLabel = (i: number) => i % every === 0 || i === points.length - 1;
  return (
    <div className="relative" dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`مسار العلامات: ${points.map((p) => `${p.label} ${p.score}`).join("، ")}`}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--chart-muted)">{t}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(pass)} y2={y(pass)} stroke="var(--chart-muted)" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - R} y={y(pass) - 5} textAnchor="end" fontSize={11} fill="var(--chart-muted)">النجاح {pass}</text>
        {hasClass && <path d={path(points.map((p) => p.classAvg))} fill="none" stroke="var(--chart-muted)" strokeWidth={2} strokeLinejoin="round" opacity={0.7} />}
        <path d={path(points.map((p) => p.score))} fill="none" stroke="var(--series-1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} stroke="var(--chart-muted)" strokeWidth={1} opacity={0.5} />}
        {points.map((p, i) => (
          <g key={p.key}>
            {hasClass && p.classAvg != null && <circle cx={x(i)} cy={y(p.classAvg)} r={3} fill="var(--chart-muted)" opacity={0.8} />}
            <circle cx={x(i)} cy={y(p.score)} r={p.drop ? 6 : 4.5} fill={p.drop ? "var(--critical)" : "var(--series-1)"} stroke="white" strokeWidth={2} />
            {showLabel(i) && <text x={x(i)} y={H - B + 18} textAnchor="middle" fontSize={11} fill="var(--chart-muted)">{p.short ?? p.label}</text>}
            {showLabel(i) && p.date && <text x={x(i)} y={H - B + 32} textAnchor="middle" fontSize={10} fill="var(--chart-muted)">{fmtDate(p.date).slice(0, 5)}</text>}
            <rect x={x(i) - Math.max(14, iw / Math.max(1, points.length) / 2)} y={T} width={Math.max(28, iw / Math.max(1, points.length))} height={ih} fill="transparent"
              onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
          </g>
        ))}
        {/* تسمية مباشرة لآخر نقطة */}
        <text x={x(points.length - 1) + (points.length > 1 ? -8 : 10)} y={y(points[points.length - 1].score) - 10} textAnchor={points.length > 1 ? "end" : "start"} fontSize={12} fontWeight={600} fill="currentColor">{points[points.length - 1].score}</text>
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs shadow-md dark:border-zinc-700 dark:bg-zinc-900" dir="rtl"
          style={{ left: `${Math.min(80, Math.max(2, (x(hover!) / W) * 100 - 10))}%` }}>
          <div className="font-semibold">{hp.label}{hp.drop && <span className="ms-1 text-red-600">● هبوط مفاجئ</span>}</div>
          {hp.date && <div className="text-zinc-500">{fmtDate(hp.date)}</div>}
          <div>العلامة: <b className="tabular-nums">{hp.score}</b></div>
          {hp.classAvg != null && <div className="text-zinc-500">معدل الصف: <span className="tabular-nums">{hp.classAvg}</span></div>}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400" dir="rtl">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: "var(--series-1)" }} />علامة الطالب</span>
        {hasClass && <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: "var(--chart-muted)" }} />معدل الصف</span>}
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--critical)" }} />هبوط مفاجئ</span>
      </div>
    </div>
  );
}

/** رسم صغير بالأسابيع: صف لكل مقياس (غياب، مشاركة، شغب)، عمود لكل أسبوع. */
export function WeeklyBars({ weeks, rows }: { weeks: string[]; rows: { label: string; values: number[]; tone?: "bad" }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!weeks.length) return <p className="py-4 text-center text-sm text-zinc-500">لا توجد حصص مسجلة بعد.</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const m = Math.max(1, ...r.values);
        return (
          <div key={r.label}>
            <div className="mb-1 flex items-center justify-between text-xs"><span className="text-zinc-600 dark:text-zinc-400">{r.label}</span><span className="tabular-nums text-zinc-500">المجموع {r.values.reduce((a, b) => a + b, 0)}</span></div>
            <div className="flex h-10 items-end gap-0.5" dir="ltr" onMouseLeave={() => setHover(null)}>
              {r.values.map((v, i) => (
                <div key={i} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} title={`أسبوع ${fmtDate(weeks[i]).slice(0, 5)}: ${v}`}>
                  <div className={cx("w-full rounded-t-[3px]", hover === i && "opacity-80")} style={{ height: v ? `${Math.max(8, (v / m) * 100)}%` : "2px", background: v ? (r.tone === "bad" ? "var(--critical)" : "var(--series-1)") : "var(--chart-grid)" }} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex justify-between text-[10px] text-zinc-400" dir="ltr">
        <span>{fmtDate(weeks[0]).slice(0, 5)}</span>
        {hover !== null && <span className="text-zinc-600 dark:text-zinc-300">أسبوع {fmtDate(weeks[hover]).slice(0, 5)}: {rows.map((r) => `${r.label} ${r.values[hover]}`).join(" · ")}</span>}
        <span>{fmtDate(weeks[weeks.length - 1]).slice(0, 5)}</span>
      </div>
    </div>
  );
}

/** أعمدة متجاورة لكل عنصر: النصف 1 بجانب النصف 2. */
export function PairBars({ items, max, labels, pass }: { items: { key: string; label: string; a: number | null; b: number | null; bPartial?: boolean }[]; max: number; labels: [string, string]; pass?: number }) {
  if (!items.length) return <p className="text-sm text-zinc-500">لا توجد بيانات بعد.</p>;
  const bar = (v: number | null, color: string, title: string) => (
    <div className="relative h-3.5 rounded bg-zinc-100 dark:bg-zinc-800" title={title}>
      {v !== null && <div className="absolute inset-y-0 start-0 rounded-e" style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: color }} />}
      {pass !== undefined && <div className="absolute inset-y-[-2px] w-0.5 bg-zinc-500" style={{ insetInlineStart: `${(pass / max) * 100}%` }} />}
    </div>
  );
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <div key={it.key} className="grid grid-cols-[minmax(80px,30%)_1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
          <div className="row-span-2 truncate">{it.label}</div>
          {bar(it.a, "var(--series-1)", `${labels[0]}: ${it.a ?? "—"}`)}
          <div className="text-left text-xs tabular-nums">{it.a ?? "—"}</div>
          {bar(it.b, "var(--series-2)", `${labels[1]}: ${it.b ?? "—"}`)}
          <div className="text-left text-xs tabular-nums">{it.b ?? "—"}{it.bPartial && it.b !== null ? "*" : ""}</div>
        </div>
      ))}
      <div className="flex flex-wrap gap-4 pt-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-1)" }} />{labels[0]}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--series-2)" }} />{labels[1]}</span>
        {pass !== undefined && <span>الخط = علامة النجاح ({pass})</span>}
        {items.some((i) => i.bPartial) && <span>* حتى الآن</span>}
      </div>
    </div>
  );
}
