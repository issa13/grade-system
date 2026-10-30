// جميع الإعدادات الافتراضية. التطبيق يقرأ القيمة من قاعدة البيانات أولاً،
// ويستعمل القيمة الافتراضية فقط عندما تكون القيمة غير موجودة.

export const COMPONENTS = ["p1", "p2", "m1", "pr1", "p3", "p4", "m2", "pr2"] as const;
export type Component = (typeof COMPONENTS)[number];

export type Band = { min: number; label: string; color: string };
/** قالب رسالة واتساب الافتراضي (موجّه للطالب). الخانات بين {} تُملأ تلقائياً. */
export const DEFAULT_WA_TEMPLATE = `مرحبا {الاسم}، هذا ملخصك لهذا الأسبوع:
• الغياب: {غياب}  • التأخير: {تأخير}
• المشاركة: {مشاركة}  • وظائف غير منجزة: {وظائف_ناقصة}
{مواد_تحت_النجاح}
علاماتك كاملة: {الرابط}
{اسم_الأستاذ}`;

type RawOverride = { grading?: Record<string, unknown>; behavior?: Record<string, unknown> };

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
    max_periodic: 20, // الفصل من 20
    max_midterm: 20, // النصف من 20
    max_progress: 20, // السعي من 20
    periodic_weight: 15, // وزن معدل الفصلين داخل معدل النصف
    midterm_weight: 25, // وزن النصف داخل معدل النصف
    sem1_weight: 0.4,
    sem2_weight: 0.4,
    progress1_weight: 0.1,
    progress2_weight: 0.1,
    decimals: 2,
    rounding: "round" as "round" | "floor" | "ceil",
    pass_mark: 10,
    missing_policy: "nc" as "nc" | "zero", // nc = إظهار NC عند نقص علامة، zero = اعتبارها صفراً
    progress_mode: "behavior" as "manual" | "behavior", // السعي: يدوي أو محسوب من السلوك
    bands: [
      { min: 18, label: "ممتاز", color: "#15803d" },
      { min: 16, label: "جيد جداً", color: "#1f7a68" },
      { min: 14, label: "جيد", color: "#0369a1" },
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
    // الإحصائيات في رابط الطالب (نفس ما يراه الأستاذ في صفحة الطالب)
    show_stats_tiles: true,
    show_stats_table: true,
    show_bars: true,
    show_attendance: true,
    show_trajectory: true,
    show_weekly: true,
    show_compare: true,
    show_class_rank: false, // يحتاج علامات الزملاء (بدون أسماء) لحساب الترتيب
    show_class_avg: false, // يحتاج علامات الزملاء (بدون أسماء) لحساب معدل الصف
    allow_pdf: true, // زر «تحميل PDF» في صفحة الطالب
  },
  labels: {
    p1: "الفصل 1",
    p2: "الفصل 2",
    m1: "النصف 1",
    pr1: "السعي 1",
    sem1: "معدل النصف 1",
    p3: "الفصل 3",
    p4: "الفصل 4",
    m2: "النصف 2",
    pr2: "السعي 2",
    sem2: "معدل النصف 2",
    final: "النهائي",
    term1: "النصف الأول",
    term2: "النصف الثاني",
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
  schedule: {
    home: "schedule" as "schedule" | "classes", // الصفحة الرئيسية: البرنامج الأسبوعي أو قائمة الصفوف
    now_before_minutes: 10, // «الآن» يبدأ قبل الحصة بـ
    now_after_minutes: 15, // ويبقى بعد نهايتها بـ
  },
  whatsapp: {
    country_code: "961",
    period: "last7" as "last7" | "since_last",
    template: DEFAULT_WA_TEMPLATE,
  },
  report: {
    title: "", // فارغ = «كشف علامات» + اسم الفترة
    show_rank: false,
    show_behavior: true,
    show_note: true,
  },
  alerts: {
    absence_streak_on: true,
    absence_streak: 3,
    low_attendance_on: true,
    low_attendance_rate: 80,
    low_attendance_min_sessions: 10,
    unlogged_on: true,
    unlogged_days: 1,
    hw_streak_on: true,
    hw_streak: 3,
    disruption_on: true,
    disruption_count: 3,
    disruption_days: 7,
    below_pass_on: true,
    drop_on: true,
    missing_grades_on: true,
    missing_grades_days: 7,
  },
  trajectory: {
    drop_points: 3, // هبوط مفاجئ: علامة أقل من معدل العلامات السابقة بهذا العدد أو أكثر
    trend_window: 3, // الاتجاه يُحسب من آخر هذا العدد من العلامات
    trend_points: 1, // «يتحسّن» / «يتراجع» إذا تغيّرت أكثر من هذا العدد
  },
  // الشعار والتوقيع (صور مصغّرة). التوقيع لا يُرسل أبداً إلى صفحة الطالب.
  report_images: { logo: "", signature: "" },
  // إعدادات محفوظة لنصف معيّن عندما يختار الأستاذ تطبيق التغيير على النصف الحالي فقط.
  // المفتاح "1" أو "2"، والقيمة = إعدادات ذلك النصف قبل التغيير.
  semester_overrides: {} as Record<string, RawOverride>,
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingsKey = keyof Settings;
export type EditableKey = Exclude<SettingsKey, "semester_overrides" | "report_images">;
export type Grading = Settings["grading"];
export type Behavior = Settings["behavior"];
export type SemesterOverride = { grading?: Partial<Grading>; behavior?: Partial<Behavior> };

/** الأوزان التي يمكن تعديلها لكل مادة على حدة (من كشف العلامات). */
export const WEIGHT_KEYS = ["periodic_weight", "midterm_weight", "sem1_weight", "sem2_weight", "progress1_weight", "progress2_weight"] as const;
export type SubjectWeights = Partial<Record<(typeof WEIGHT_KEYS)[number], number>>;
export const subjectKey = (subjectId: string) => `subject:${subjectId}`;

export const SECTION_TITLES: Record<EditableKey, string> = {
  profile: "الملف الشخصي",
  year: "السنة الدراسية",
  schedule: "البرنامج الأسبوعي",
  grading: "حساب العلامات",
  behavior: "نقاط السلوك",
  attendance: "الحضور",
  visibility: "ما يراه الطالب",
  labels: "التسميات",
  whatsapp: "واتساب",
  report: "التقرير",
  alerts: "التنبيهات",
  trajectory: "المسار",
  data: "البيانات",
};

// التسميات الافتراضية القديمة: إذا كانت محفوظة كما هي، نستبدلها بالجديدة تلقائياً.
const OLD_LABEL_DEFAULTS: Record<string, string> = {
  p1: "الفتري 1", p2: "الفتري 2", m1: "الفصل 1", sem1: "النصف 1",
  p3: "الفتري 3", p4: "الفتري 4", m2: "الفصل 2", sem2: "النصف 2",
};

// سلّم التقديرات الافتراضي القديم: إذا كان محفوظاً كما هو، يُستبدل بالجديد.
const OLD_BANDS_KEY = "16:ممتاز|14:جيد جداً|12:جيد|10:مقبول|0:راسب";
const bandsKey = (b: Band[]) => b.map((x) => `${x.min}:${x.label}`).join("|");

/** الإعدادات الفعلية لكل نصف ولحساب النهائي، مع أوزان المادة الخاصة إن وُجدت. */
export type Effective = { sem: { 1: Settings; 2: Settings }; final: Settings };

export function effectiveSettings(s: Settings, subject?: SubjectWeights | null): Effective {
  const sub: SubjectWeights = {};
  for (const k of WEIGHT_KEYS) {
    const v = subject?.[k];
    if (typeof v === "number" && !Number.isNaN(v)) sub[k] = v;
  }
  const mk = (ov?: SemesterOverride): Settings => ({
    ...s,
    grading: { ...s.grading, ...(ov?.grading ?? {}), ...sub },
    behavior: { ...s.behavior, ...(ov?.behavior ?? {}) },
  });
  const ov = s.semester_overrides as Record<string, SemesterOverride | undefined>;
  return { sem: { 1: mk(ov?.["1"]), 2: mk(ov?.["2"]) }, final: mk() };
}

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
  if (Array.isArray(out.grading.bands) && bandsKey(out.grading.bands) === OLD_BANDS_KEY) {
    out.grading.bands = structuredClone(DEFAULT_SETTINGS.grading.bands);
  }
  for (const [k, old] of Object.entries(OLD_LABEL_DEFAULTS)) {
    const L = out.labels as Record<string, string>;
    if (L[k] === old) L[k] = (DEFAULT_SETTINGS.labels as Record<string, string>)[k];
  }
  return out;
}
