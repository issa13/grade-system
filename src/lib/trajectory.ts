// مسار الطالب عبر الوقت: ترتيب الامتحانات، الاتجاه، والهبوط المفاجئ.
import { computeRow, type Entries, type GradeRow } from "./grades";
import { effectiveSettings, type Component, type Settings, type SubjectWeights } from "./settings";

/** الامتحانات بترتيبها الطبيعي: الفصل 1، الفصل 2، النصف 1، ثم النصف الثاني. */
export const EXAMS = ["p1", "p2", "m1", "p3", "p4", "m2"] as const satisfies readonly Component[];
export type Exam = (typeof EXAMS)[number];
export const isExam = (c: string): c is Exam => (EXAMS as readonly string[]).includes(c);

export type Dates = Partial<Record<Exam, string>>;

/** ترتيب الامتحانات حسب التاريخ. امتحان بدون تاريخ يأخذ مكانه الطبيعي بعد الامتحان الذي قبله. */
export function examOrder(dates: Dates = {}): { comp: Exam; date: string | null; sortKey: string }[] {
  let prev = "";
  const list = EXAMS.map((comp, i) => {
    const d = dates[comp] ?? null;
    if (d && d > prev) prev = d;
    return { comp, date: d, sortKey: `${d ?? prev}|${i}` };
  });
  return list.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

export type Point = {
  comp: Exam;
  date: string | null;
  score: number; // من السلم (20)
  classAvg: number | null;
  drop: boolean; // هبوط مفاجئ
};

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

/**
 * نقاط طالب في مادة: علامات الامتحانات (محوّلة إلى 20) حسب التاريخ.
 * المعفى أو بدون علامة لا يظهر كنقطة (لا نقطة صفر).
 */
export function subjectPoints(studentId: string, rows: Record<string, GradeRow>, dates: Dates, s: Settings): Point[] {
  const row = rows[studentId];
  if (!row) return [];
  const out: Point[] = [];
  for (const { comp, date } of examOrder(dates)) {
    const v = row[comp];
    if (typeof v !== "number") continue;
    const others = Object.values(rows).map((r) => r[comp]).filter((x): x is number => typeof x === "number");
    out.push({ comp, date, score: v, classAvg: r2(mean(others)), drop: false });
  }
  markDrops(out, s);
  return out;
}

/** هبوط مفاجئ: علامة أقل بـ (3) نقاط أو أكثر من معدل علامات الطالب السابقة في نفس المادة. */
export function markDrops<T extends { score: number; drop: boolean }>(pts: T[], s: Settings): T[] {
  for (let i = 1; i < pts.length; i++) {
    const prev = mean(pts.slice(0, i).map((p) => p.score))!;
    pts[i].drop = prev - pts[i].score >= s.trajectory.drop_points - 1e-9;
  }
  return pts;
}

export type Trend = "up" | "down" | "flat";
/** الاتجاه من آخر 3 علامات: «يتحسّن» إذا ارتفعت أكثر من نقطة، «يتراجع» إذا نزلت أكثر من نقطة، وإلا «ثابت». */
export function trendOf(values: number[], s: Settings): Trend | null {
  const last = values.slice(-Math.max(2, s.trajectory.trend_window));
  if (last.length < 2) return null;
  const d = last[last.length - 1] - last[0];
  if (d > s.trajectory.trend_points) return "up";
  if (d < -s.trajectory.trend_points) return "down";
  return "flat";
}
export const TREND_LABEL: Record<Trend, string> = { up: "يتحسّن", down: "يتراجع", flat: "ثابت" };
export const TREND_ARROW: Record<Trend, string> = { up: "↑", down: "↓", flat: "→" };

export type SubjectInput = { id: string; name: string; weight: number; entries: Record<string, Entries>; dates: Dates; weights?: SubjectWeights | null };

/**
 * «كل المواد»: المعدل العام حتى الآن بعد كل امتحان (من علامات الامتحانات فقط، حسب وزن كل مادة).
 */
export function overallPoints(studentId: string, subjects: SubjectInput[], s: Settings): { key: string; label: string; date: string | null; score: number; subjectId: string; comp: Exam }[] {
  const events: { subjectId: string; comp: Exam; date: string | null; sortKey: string }[] = [];
  for (const sj of subjects) {
    const en = sj.entries[studentId] ?? {};
    for (const o of examOrder(sj.dates)) {
      const e = en[o.comp];
      if (!e || e.excused || e.score === null || e.score === undefined) continue;
      events.push({ subjectId: sj.id, comp: o.comp, date: o.date, sortKey: o.sortKey });
    }
  }
  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const seen: Record<string, Set<Exam>> = {};
  const out: { key: string; label: string; date: string | null; score: number; subjectId: string; comp: Exam }[] = [];
  for (const ev of events) {
    (seen[ev.subjectId] ??= new Set()).add(ev.comp);
    let n = 0, d = 0;
    for (const sj of subjects) {
      const set = seen[sj.id];
      if (!set) continue;
      const en = sj.entries[studentId] ?? {};
      const part: Entries = {};
      for (const c of set) if (en[c]) part[c] = en[c];
      const row = computeRow(part, effectiveSettings(s, sj.weights));
      const cur = row.sem1Current !== null || row.sem2Current !== null ? avgSem(row, s, sj.weights) : null;
      if (cur !== null) { n += cur * sj.weight; d += sj.weight; }
    }
    if (d) out.push({ key: `${ev.subjectId}:${ev.comp}`, label: ev.comp, date: ev.date, score: Math.round((n / d) * 100) / 100, subjectId: ev.subjectId, comp: ev.comp });
  }
  return out;
}

/** معدل النصفين الموجودين حسب وزنيهما في النهائي (بدون السعي). */
function avgSem(row: GradeRow, s: Settings, w?: SubjectWeights | null): number | null {
  const g = effectiveSettings(s, w).final.grading;
  let n = 0, d = 0;
  if (row.sem1Current !== null) { n += row.sem1Current * g.sem1_weight; d += g.sem1_weight; }
  if (row.sem2Current !== null) { n += row.sem2Current * g.sem2_weight; d += g.sem2_weight; }
  return d ? n / d : null;
}

/** اتجاه الطالب العام (للسهم بجانب الاسم). */
export function overallTrend(studentId: string, subjects: SubjectInput[], s: Settings): Trend | null {
  return trendOf(overallPoints(studentId, subjects, s).map((p) => p.score), s);
}

/** أسابيع السنة (للرسم الصغير): مفتاح الأسبوع = تاريخ أول يوم (الإثنين). */
export function weekKey(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const back = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - back);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
