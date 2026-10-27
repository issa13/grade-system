// جميع الإعدادات الافتراضية. التطبيق يقرأ القيمة من قاعدة البيانات أولاً،
// ويستعمل القيمة الافتراضية فقط عندما تكون القيمة غير موجودة.

export const COMPONENTS = ["p1", "p2", "m1", "pr1", "p3", "p4", "m2", "pr2"] as const;
export type Component = (typeof COMPONENTS)[number];

export type Band = { min: number; label: string; color: string };

export const DEFAULT_SETTINGS = {
  profile: {
    teacher_name: "",
    school_name: "",
    logo_url: "",
    theme: "system" as "light" | "dark" | "system",
    date_format: "dd/MM/yyyy",
  },
  year: {
    school_year: "2026-2027",
    start: "2026-09-15",
    sem1_end: "2027-01-31",
    end: "2027-06-15",
    weekend_days: [6] as number[], // 0 = الأحد ... 6 = السبت
    breaks: [] as { from: string; to: string; label: string }[],
  },
  grading: {
    scale: 20, // العلامة النهائية من 20
    max_periodic: 20, // الفتري من 20
    max_midterm: 40, // الفصل من 40
    max_progress: 20, // السعي من 20
    periodic_weight: 15, // وزن معدل الفتريين داخل النصف
    midterm_weight: 25, // وزن الفصل داخل النصف
    sem1_weight: 0.4,
    sem2_weight: 0.4,
    progress1_weight: 0.1,
    progress2_weight: 0.1,
    decimals: 2,
    rounding: "round" as "round" | "floor" | "ceil",
    pass_mark: 10,
    missing_policy: "nc" as "nc" | "zero", // nc = إظهار NC عند نقص علامة، zero = اعتبارها صفراً
    progress_mode: "manual" as "manual" | "behavior", // السعي: يدوي أو محسوب من السلوك
    bands: [
      { min: 16, label: "ممتاز", color: "#15803d" },
      { min: 14, label: "جيد جداً", color: "#1f7a68" },
      { min: 12, label: "جيد", color: "#0369a1" },
      { min: 10, label: "مقبول", color: "#b45309" },
      { min: 0, label: "راسب", color: "#b91c1c" },
    ] as Band[],
  },
  behavior: {
    // السعي المحسوب = الأساس + مجموع النقاط (ضمن 0 و max_progress)
    base: 14,
    participation: 0.5,
    disruption: -1,
    late: -0.25,
    absent_unexcused: -1,
    absent_excused: 0,
    hw_done: 0.25,
    hw_missing: -0.5,
    participation_max_per_session: 3,
  },
  attendance: {
    late_threshold_minutes: 10,
    excused_counts_as_absent: false,
  },
  visibility: {
    components: ["p1", "p2", "m1", "pr1", "p3", "p4", "m2", "pr2"] as Component[],
    show_semesters: true,
    show_final: true,
    show_overall: true,
    show_behavior: true,
    show_band: true,
  },
  labels: {
    p1: "الفتري 1",
    p2: "الفتري 2",
    m1: "الفصل 1",
    pr1: "السعي 1",
    sem1: "النصف 1",
    p3: "الفتري 3",
    p4: "الفتري 4",
    m2: "الفصل 2",
    pr2: "السعي 2",
    sem2: "النصف 2",
    final: "النهائي",
    participation: "مشاركة",
    disruption: "شغب",
    late: "تأخير",
    absent: "غياب",
    excused: "بعذر",
    unexcused: "بدون عذر",
    homework: "الوظيفة",
    hw_done: "منجزة",
    hw_missing: "غير منجزة",
    note: "ملاحظة",
  },
  data: {
    trash_retention_days: 30,
  },
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof Settings;

export const SECTION_TITLES: Record<SettingsKey, string> = {
  profile: "الملف الشخصي",
  year: "السنة الدراسية",
  grading: "حساب العلامات",
  behavior: "نقاط السلوك",
  attendance: "الحضور",
  visibility: "ما يراه الطالب",
  labels: "التسميات",
  data: "البيانات",
};

/** دمج القيم المخزنة مع القيم الافتراضية (القيم الناقصة تأخذ الافتراضي). */
export function mergeSettings(stored: Partial<Record<string, unknown>> | null | undefined): Settings {
  const out = structuredClone(DEFAULT_SETTINGS) as Settings;
  if (!stored) return out;
  for (const key of Object.keys(out) as SettingsKey[]) {
    const v = stored[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      (out as Record<string, unknown>)[key] = { ...(out[key] as object), ...(v as object) };
    }
  }
  return out;
}
