import type { Settings } from "./settings";

export function toISO(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function today(): string { return toISO(new Date()); }

export function semesterFor(date: string, s: Settings): 1 | 2 {
  return date <= s.year.sem1_end ? 1 : 2;
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

/** كل التواريخ بين from و to التي تقع في أيام الأسبوع المطلوبة، مع استثناء العطل. */
export function datesBetween(from: string, to: string, weekdays: number[], s: Settings): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const cur = new Date(y, m - 1, d);
  for (let i = 0; i < 400; i++) {
    const iso = toISO(cur);
    if (iso > to) break;
    const inBreak = s.year.breaks.some((b) => iso >= b.from && iso <= b.to);
    if (weekdays.includes(cur.getDay()) && !s.year.weekend_days.includes(cur.getDay()) && !inBreak) out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
