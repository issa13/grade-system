// محرك حساب العلامات — نفس معادلات ملف الإكسل، لكن الأوزان والقيم القصوى من الإعدادات.
//
// النصف = (معدل الفتريين × وزن الفتري + الفصل × وزن الفصل) ÷ (وزن الفتري + وزن الفصل)
// النهائي = النصف1×0.4 + النصف2×0.4 + السعي1×0.1 + السعي2×0.1
// كل العلامات تُحوَّل أولاً إلى السلم (من 20).
// - لا توجد أي علامة  ← النتيجة فارغة (null)
// - توجد علامة ناقصة ← "NC" (غير مكتمل)، أو صفر إذا اختار الأستاذ ذلك في الإعدادات.

import type { Component, Settings } from "./settings";

export type Entry = { score: number | null; excused?: boolean };
export type Entries = Partial<Record<Component, Entry>>;
export type Result = number | "NC" | null;

export type BehaviorAgg = {
  sessions?: number;
  participation?: number;
  disruption?: number;
  late?: number;
  absent_excused?: number;
  absent_unexcused?: number;
  hw_done?: number;
  hw_missing?: number;
};

export type GradeRow = {
  p1: Result; p2: Result; m1: Result; pr1: Result; sem1: Result;
  p3: Result; p4: Result; m2: Result; pr2: Result; sem2: Result;
  final: Result;
};

type G = Settings["grading"];

export function roundTo(v: number, g: Pick<G, "decimals" | "rounding">): number {
  const f = Math.pow(10, g.decimals);
  const fn = g.rounding === "floor" ? Math.floor : g.rounding === "ceil" ? Math.ceil : Math.round;
  return fn(v * f + (g.rounding === "round" ? Number.EPSILON : 0)) / f;
}

function maxFor(c: Component, g: G): number {
  if (c.startsWith("pr")) return g.max_progress;
  if (c.startsWith("m")) return g.max_midterm;
  return g.max_periodic;
}

/** قيمة مكوّن واحد محوّلة إلى السلم. "excused" = معفى (لا يدخل في المعدل). */
function norm(c: Component, e: Entry | undefined, g: G): number | "missing" | "excused" {
  if (!e) return "missing";
  if (e.excused) return "excused";
  if (e.score === null || e.score === undefined || Number.isNaN(e.score)) return "missing";
  return (Number(e.score) / maxFor(c, g)) * g.scale;
}

function semester(pa: Component, pb: Component, m: Component, en: Entries, g: G): Result {
  const a = norm(pa, en[pa], g);
  const b = norm(pb, en[pb], g);
  const mm = norm(m, en[m], g);
  const vals = [a, b, mm];
  if (vals.every((v) => v === "missing")) return null;
  const fill = (v: number | "missing" | "excused") =>
    v === "missing" && g.missing_policy === "zero" ? 0 : v;
  const A = fill(a), B = fill(b), M = fill(mm);
  if ([A, B, M].includes("missing")) return "NC";
  const periodics = [A, B].filter((v): v is number => typeof v === "number");
  if (M === "excused" && periodics.length === 0) return null;
  let num = 0, den = 0;
  if (periodics.length) {
    num += (periodics.reduce((s, v) => s + v, 0) / periodics.length) * g.periodic_weight;
    den += g.periodic_weight;
  }
  if (typeof M === "number") {
    num += M * g.midterm_weight;
    den += g.midterm_weight;
  }
  return den === 0 ? null : num / den;
}

/** السعي المحسوب من السلوك والوظائف. */
export function progressFromBehavior(b: BehaviorAgg | undefined, s: Settings): number | null {
  if (!b || !b.sessions) return null;
  const p = s.behavior;
  const points =
    (b.participation ?? 0) * p.participation +
    (b.disruption ?? 0) * p.disruption +
    (b.late ?? 0) * p.late +
    (b.absent_unexcused ?? 0) * p.absent_unexcused +
    (b.absent_excused ?? 0) * p.absent_excused +
    (b.hw_done ?? 0) * p.hw_done +
    (b.hw_missing ?? 0) * p.hw_missing;
  const max = s.grading.max_progress;
  return Math.max(0, Math.min(max, p.base + points));
}

/** حساب صف طالب كامل لمادة واحدة. */
export function computeRow(
  entriesIn: Entries,
  s: Settings,
  behavior?: { 1?: BehaviorAgg; 2?: BehaviorAgg },
): GradeRow {
  const g = s.grading;
  const en: Entries = { ...entriesIn };
  if (g.progress_mode === "behavior") {
    for (const [c, sem] of [["pr1", 1], ["pr2", 2]] as const) {
      if (en[c]?.score == null && !en[c]?.excused) {
        const v = progressFromBehavior(behavior?.[sem], s);
        if (v !== null) en[c] = { score: v };
      }
    }
  }

  const show = (c: Component): Result => {
    const v = norm(c, en[c], g);
    return typeof v === "number" ? roundTo(v, g) : null;
  };

  const sem1 = semester("p1", "p2", "m1", en, g);
  const sem2 = semester("p3", "p4", "m2", en, g);
  const pr1 = norm("pr1", en.pr1, g);
  const pr2 = norm("pr2", en.pr2, g);

  // النهائي
  const parts: [Result | "missing" | "excused", number][] = [
    [sem1, g.sem1_weight],
    [sem2, g.sem2_weight],
    [pr1, g.progress1_weight],
    [pr2, g.progress2_weight],
  ];
  let final: Result;
  const allEmpty = parts.every(([v]) => v === null || v === "missing");
  if (allEmpty) final = null;
  else {
    let num = 0, den = 0, nc = false;
    for (const [v, w] of parts) {
      if (v === "excused") continue;
      let val: number | null;
      if (typeof v === "number") val = v;
      else if (g.missing_policy === "zero") val = 0;
      else { nc = true; val = null; }
      if (val !== null) { num += val * w; den += w; }
    }
    final = nc ? "NC" : den === 0 ? null : num / den;
  }

  const r = (v: Result): Result => (typeof v === "number" ? roundTo(v, g) : v);
  return {
    p1: show("p1"), p2: show("p2"), m1: show("m1"), pr1: typeof pr1 === "number" ? roundTo(pr1, g) : null, sem1: r(sem1),
    p3: show("p3"), p4: show("p4"), m2: show("m2"), pr2: typeof pr2 === "number" ? roundTo(pr2, g) : null, sem2: r(sem2),
    final: r(final),
  };
}

/** المعدل العام لعدة مواد حسب أوزان المواد. */
export function overallAverage(items: { final: Result; weight: number }[], s: Settings): Result {
  const withData = items.filter((i) => i.final !== null);
  if (!withData.length) return null;
  if (withData.length < items.length && s.grading.missing_policy === "nc") return "NC";
  if (withData.some((i) => i.final === "NC")) return "NC";
  let num = 0, den = 0;
  for (const i of withData) {
    num += (i.final as number) * i.weight;
    den += i.weight;
  }
  return den ? roundTo(num / den, s.grading) : null;
}

export function bandFor(v: Result, s: Settings) {
  if (typeof v !== "number") return null;
  const bands = [...s.grading.bands].sort((a, b) => b.min - a.min);
  return bands.find((b) => v >= b.min) ?? null;
}

export function fmt(v: Result): string {
  if (v === null) return "";
  if (v === "NC") return "NC";
  return String(v);
}
