"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { BandCount } from "@/lib/stats";
import { Info } from "./info";
import { Card, cx } from "./ui";

/** بطاقة رقم واحد (مؤشر). */
export function StatTile({ label, value, sub, info, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; info?: ReactNode; tone?: "good" | "bad" | "warn";
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center text-xs font-medium text-zinc-500">
        {label}{info && <Info title={label}>{info}</Info>}
      </div>
      <div className={cx("mt-1 whitespace-nowrap text-xl font-bold tabular-nums sm:text-2xl",
        tone === "good" && "text-green-700 dark:text-green-400", tone === "bad" && "text-red-600 dark:text-red-400", tone === "warn" && "text-amber-600")}>
        {value ?? "—"}
      </div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </Card>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 print:grid-cols-5">{children}</div>;
}

export function Section({ title, info, children, actions }: { title: string; info?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="flex items-center font-semibold">{title}{info && <Info title={title}>{info}</Info>}</h3>
        <div className="flex-1" />
        {actions}
      </div>
      {children}
    </Card>
  );
}

export type Bar = { key: string; label: ReactNode; value: number | null; display?: ReactNode; href?: string; color?: string; tip?: string };

/** أشرطة أفقية لسلسلة واحدة — القيمة مكتوبة بجانب كل شريط. */
export function BarList({ items, max, marker, empty = "لا توجد بيانات بعد." }: { items: Bar[]; max: number; marker?: { value: number; label: string }; empty?: string }) {
  if (!items.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const w = it.value === null ? 0 : Math.max(0, Math.min(100, (it.value / max) * 100));
        const label = it.href ? <Link href={it.href} className="hover:text-brand-600 hover:underline">{it.label}</Link> : it.label;
        return (
          <div key={it.key} className="group grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-3 text-sm" title={it.tip}>
            <div className="truncate">{label}</div>
            <div className="relative h-5 rounded bg-zinc-100 dark:bg-zinc-800">
              <div className="absolute inset-y-0 start-0 rounded-e" style={{ width: `${w}%`, background: it.color ?? "var(--color-brand-500)" }} />
              {marker && (
                <div className="absolute inset-y-[-3px] w-0.5 bg-zinc-500 dark:bg-zinc-400" style={{ insetInlineStart: `${(marker.value / max) * 100}%` }} title={marker.label} />
              )}
            </div>
            <div className="min-w-[3.5rem] text-left font-medium tabular-nums">{it.display ?? (it.value ?? "—")}</div>
          </div>
        );
      })}
      {marker && <p className="pt-1 text-xs text-zinc-500">الخط العمودي = {marker.label}</p>}
    </div>
  );
}

/** توزيع على سلّم التقديرات: شريط واحد مقسوم + مفتاح بالأعداد. */
export function Distribution({ bands }: { bands: BandCount[] }) {
  const total = bands.reduce((a, b) => a + b.count, 0);
  if (!total) return <p className="text-sm text-zinc-500">لا توجد علامات بعد.</p>;
  return (
    <div>
      <div className="flex h-7 w-full gap-0.5 overflow-hidden rounded" role="img" aria-label={bands.map((b) => `${b.label}: ${b.count}`).join("، ")}>
        {bands.filter((b) => b.count).map((b) => (
          <div key={b.label} title={`${b.label}: ${b.count} (${Math.round((b.count / total) * 100)}%)`} style={{ width: `${(b.count / total) * 100}%`, background: b.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {bands.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
            {b.label}: <b className="tabular-nums text-zinc-900 dark:text-zinc-100">{b.count}</b>
            <span className="tabular-nums text-zinc-400">({Math.round((b.count / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** قائمة مرتبة قصيرة (الأعلى/الأدنى...). */
export function RankList({ items, empty = "—" }: { items: { key: string; label: ReactNode; value: ReactNode; href?: string; rank?: number }[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <ol className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {items.map((it, i) => (
        <li key={it.key} className="flex items-center gap-3 py-1.5">
          <span className="w-6 text-xs tabular-nums text-zinc-400">{it.rank ?? i + 1}</span>
          <span className="flex-1 truncate">{it.href ? <Link href={it.href} className="hover:text-brand-600 hover:underline">{it.label}</Link> : it.label}</span>
          <span className="font-medium tabular-nums">{it.value}</span>
        </li>
      ))}
    </ol>
  );
}

export const fmtPct = (v: number | null) => (v === null ? "—" : `${v}%`);
