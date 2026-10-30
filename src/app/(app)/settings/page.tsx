"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useSettings } from "@/components/settings-provider";
import { COMPONENTS, DEFAULT_SETTINGS, SECTION_TITLES, type EditableKey, type SemesterOverride, type Settings } from "@/lib/settings";
import { semesterFor, today } from "@/lib/dates";
import { downloadJson } from "@/lib/excel";
import { BACKUP_TABLES, BACKUP_VERSION } from "@/lib/backup-tables";
import { validateSection } from "@/lib/validate-settings";
import { clearErrors, friendly, readErrors, type LoggedError } from "@/lib/errors";
import { WEEKDAYS } from "@/lib/types";
import { Info } from "@/components/info";
import { Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, confirmAction, cx, useToast } from "@/components/ui";

const FIELD_LABELS: Record<string, string> = {
  teacher_name: "اسم الأستاذ", school_name: "اسم المدرسة", logo_url: "رابط الشعار (اختياري)", theme: "المظهر", date_format: "صيغة التاريخ",
  school_year: "السنة الدراسية", start: "بداية السنة", sem1_end: "نهاية النصف الأول", end: "نهاية السنة",
  scale: "العلامة النهائية من", max_periodic: "علامة الفصل من", max_midterm: "علامة النصف من", max_progress: "علامة السعي من",
  periodic_weight: "وزن معدل الفصلين داخل معدل النصف", midterm_weight: "وزن النصف داخل معدل النصف",
  sem1_weight: "وزن معدل النصف 1 في النهائي", sem2_weight: "وزن معدل النصف 2 في النهائي",
  progress1_weight: "وزن السعي 1 في النهائي", progress2_weight: "وزن السعي 2 في النهائي",
  decimals: "عدد الخانات العشرية", rounding: "طريقة التقريب", pass_mark: "علامة النجاح",
  missing_policy: "عند نقص علامة", progress_mode: "طريقة حساب السعي",
  base: "علامة السعي الأساسية", participation: "نقاط كل مشاركة", disruption: "نقاط كل شغب", late: "نقاط كل تأخير",
  absent_unexcused: "نقاط غياب بدون عذر", absent_excused: "نقاط غياب بعذر", hw_done: "نقاط وظيفة منجزة", hw_missing: "نقاط وظيفة غير منجزة",
  participation_max_per_session: "أقصى عدد مشاركات في الحصة",
  late_threshold_minutes: "يعتبر متأخراً بعد (دقائق)", excused_counts_as_absent: "الغياب بعذر يُحسب غياباً",
  show_semesters: "إظهار معدل كل نصف", show_final: "إظهار العلامة النهائية", show_overall: "إظهار المعدل العام",
  show_behavior: "إظهار ملخص السلوك تحت كل مادة", show_band: "إظهار التقدير",
  show_stats_tiles: "بطاقات الإحصائيات (المعدل، الحضور، المشاركة، الوظائف)", show_stats_table: "جدول العلامات في كل مادة",
  show_bars: "رسم النهائي في كل مادة", show_attendance: "الحضور والسلوك حسب المادة", show_trajectory: "مسار العلامات (الرسم)",
  show_weekly: "الرسم بالأسابيع (غياب، مشاركة، شغب)", show_compare: "مقارنة النصفين", show_class_rank: "الترتيب في الصف وفي كل مادة",
  show_class_avg: "معدل الصف (للمقارنة)", allow_pdf: "زر «تحميل PDF» للطالب",
  trash_retention_days: "مدة الاحتفاظ بالمحذوفات (أيام)",
  home: "الصفحة الرئيسية", now_before_minutes: "«الآن» يبدأ قبل الحصة بـ (دقائق)", now_after_minutes: "«الآن» يبقى بعد نهاية الحصة (دقائق)",
  country_code: "مفتاح الدولة", period: "فترة الأرقام في الرسالة", template: "قالب الرسالة",
  title: "عنوان التقرير", show_rank: "إظهار الترتيب في الصف", show_note: "إظهار ملاحظة الأستاذ",
  absence_streak_on: "غياب متتالٍ", absence_streak: "عدد الحصص المتتالية",
  low_attendance_on: "نسبة حضور منخفضة", low_attendance_rate: "أقل من (%)", low_attendance_min_sessions: "بعد عدد حصص مسجلة",
  unlogged_on: "حصص غير مسجلة", unlogged_days: "مضى عليها (أيام)",
  hw_streak_on: "وظائف ناقصة متتالية", hw_streak: "عدد المرات المتتالية",
  disruption_on: "شغب متكرر", disruption_count: "عدد مرات الشغب", disruption_days: "خلال (أيام)",
  below_pass_on: "تحت علامة النجاح", drop_on: "هبوط مفاجئ", missing_grades_on: "علامات ناقصة", missing_grades_days: "بعد تاريخ الامتحان بـ (أيام)",
  drop_points: "الهبوط المفاجئ (نقاط)", trend_window: "الاتجاه من آخر (علامات)", trend_points: "يتحسّن / يتراجع إذا تغيّر أكثر من (نقاط)",
};

// شرح كل خانة (يظهر عند الضغط على ⓘ)
const FIELD_INFO: Record<string, string> = {
  teacher_name: "يظهر في القائمة الجانبية وفي صفحة الإحصائيات.",
  school_name: "يظهر في أعلى الموقع وفي صفحة علامات الطالب.",
  logo_url: "رابط صورة الشعار (يبدأ بـ https). يظهر في صفحة علامات الطالب.",
  theme: "فاتح، داكن، أو حسب إعداد جهازك.",
  date_format: "صيغة عرض التواريخ.",
  school_year: "اسم السنة الدراسية، يظهر في العناوين والتصدير.",
  start: "أول يوم دراسة. تُستعمل لتوليد حصص النصف الأول.",
  sem1_end: "آخر يوم في النصف الأول. كل حصة أو واجب بعد هذا التاريخ يُحسب للنصف الثاني، والموقع يعرف منه «النصف الحالي».",
  end: "آخر يوم دراسة. تُستعمل لتوليد حصص النصف الثاني.",
  weekend_days: "لا تُولَّد حصص في هذه الأيام.",
  breaks: "العطل الرسمية: لا تُولَّد حصص بين تاريخ البداية والنهاية.",
  scale: "كل العلامات تُحوَّل إلى هذا الرقم قبل الحساب وعند التصدير (عادةً 20).",
  max_periodic: "العلامة القصوى التي تُدخلها لامتحانات الفصل (1 إلى 4). إذا كانت مختلفة عن 20 تُحوَّل تلقائياً.",
  max_midterm: "العلامة القصوى التي تُدخلها لامتحانَي النصف.",
  max_progress: "العلامة القصوى للسعي (اليدوي أو المحسوب).",
  periodic_weight: "معدل النصف = (معدل الفصلين × هذا الوزن + النصف × وزن النصف) ÷ مجموع الوزنين. مثال: 15 و 25 يعني الفصول 37.5% والنصف 62.5%.",
  midterm_weight: "وزن امتحان النصف داخل معدل النصف (انظر الخانة السابقة).",
  sem1_weight: "مساهمة معدل النصف 1 في النهائي. يُفضَّل أن يكون مجموع الأوزان الأربعة = 1.",
  sem2_weight: "مساهمة معدل النصف 2 في النهائي.",
  progress1_weight: "مساهمة السعي 1 في النهائي.",
  progress2_weight: "مساهمة السعي 2 في النهائي.",
  decimals: "عدد الأرقام بعد الفاصلة في النتائج (مثلاً 2 → 13.69).",
  rounding: "تقريب عادي (13.685 → 13.69)، للأسفل (→ 13.68)، أو للأعلى.",
  pass_mark: "أي علامة أقل منها تظهر بالأحمر وتُحسب «راسب» في الإحصائيات.",
  missing_policy: "إذا نقصت علامة: إظهار NC حتى تكتمل العلامات، أو اعتبار العلامة الناقصة صفراً.",
  progress_mode: "محسوب: السعي = العلامة الأساسية + نقاط السلوك والوظائف (من قسم نقاط السلوك). إذا أدخلت السعي يدوياً لطالب، قيمتك تتقدّم على المحسوبة.",
  base: "علامة السعي التي يبدأ منها كل طالب قبل إضافة أو خصم النقاط.",
  participation: "تُضاف لكل مشاركة مسجلة في الحصة.",
  disruption: "قيمة سالبة تُخصم لكل مرة شغب.",
  late: "قيمة سالبة تُخصم لكل تأخير.",
  absent_unexcused: "قيمة سالبة تُخصم لكل غياب بدون عذر.",
  absent_excused: "عادةً 0: الغياب بعذر لا يُخصم.",
  hw_done: "تُضاف لكل وظيفة منجزة (من الحصص أو من تبويب الواجبات).",
  hw_missing: "تُخصم لكل وظيفة غير منجزة.",
  participation_max_per_session: "أقصى عدد مشاركات يمكن تسجيله للطالب في حصة واحدة (0 = بلا حد).",
  late_threshold_minutes: "للتذكير فقط: بعد كم دقيقة يُعتبر الطالب متأخراً.",
  excused_counts_as_absent: "هل يُحسب الغياب بعذر غياباً في نسبة الحضور.",
  components: "العلامات المشطوبة لا تظهر للطالب (مثلاً امتحان لم تُعلن نتيجته بعد). النهائي يبقى NC عنده حتى تُظهرها.",
  show_semesters: "إظهار معدل النصف 1 و 2 في صفحة الطالب.",
  show_final: "إظهار العلامة النهائية لكل مادة.",
  show_overall: "إظهار المعدل العام لكل المواد في أعلى الصفحة.",
  show_behavior: "إظهار عدد المشاركات والشغب والتأخير والغياب والوظائف.",
  show_band: "إظهار التقدير (ممتاز، جيد جداً...).",
  show_stats_tiles: "في رابط الطالب: نفس بطاقات صفحة الطالب عندك.",
  show_stats_table: "المعدلات والنهائي في كل مادة، مع الحضور.",
  show_bars: "رسم أفقي لعلامة كل مادة مع خط النجاح.",
  show_attendance: "الغياب والتأخير والمشاركة والشغب والوظائف لكل مادة.",
  show_trajectory: "رسم العلامات عبر الوقت مع الاتجاه والهبوط المفاجئ.",
  show_weekly: "غياب ومشاركة وشغب الطالب في كل أسبوع.",
  show_compare: "النصف الأول مقابل الثاني (يظهر بعد أول علامة من النصف الثاني).",
  show_class_rank: "⚠ لحساب الترتيب يُرسل إلى صفحة الطالب علامات زملائه بدون أسماء وبترتيب عشوائي. أوقفه إذا لا تريد ذلك.",
  show_class_avg: "⚠ مثل الترتيب: يحتاج علامات الزملاء بدون أسماء لحساب معدل الصف.",
  allow_pdf: "الطالب يستطيع تحميل صفحته كملف PDF (نفس ما يراه).",
  bands: "كل علامة ≥ الحد الأدنى تأخذ هذا التقدير. الترتيب لا يهم.",
  trash_retention_days: "العناصر المحذوفة تبقى في سلة المحذوفات هذه المدة ثم تُحذف نهائياً.",
  home: "البرنامج الأسبوعي (حصص الأسبوع بأوقاتها) أو قائمة الصفوف كما في الإصدار الأول.",
  now_before_minutes: "الحصة تظهر بإطار «الآن» وزر «سجّل» قبل بدايتها بهذا العدد من الدقائق.",
  now_after_minutes: "وتبقى «الآن» بعد نهايتها بهذا العدد من الدقائق، ثم تصبح «غير مسجّلة» إذا لم تُسجّل.",
  country_code: "يُضاف للأرقام المكتوبة بدون مفتاح (مثلاً 03 123 456 ← 9613123456). لبنان = 961.",
  period: "الأرقام في الرسالة (غياب، تأخير، مشاركة…) تُحسب لهذه الفترة.",
  template: "الخانات المتاحة: {الاسم} {الصف} {غياب} {تأخير} {مشاركة} {شغب} {وظائف_ناقصة} {المعدل} {مواد_تحت_النجاح} {الرابط} {اسم_الأستاذ} {اسم_المدرسة}. السطر الذي فيه خانة فارغة يُحذف.",
  title: "فارغ = «كشف علامات» + اسم الفترة (مثلاً «كشف علامات النصف الأول»).",
  show_rank: "ترتيب الطالب في الصف حسب المعدل العام للفترة.",
  show_note: "ملاحظة تكتبها لكل طالب قبل الطباعة (مع جمل جاهزة مقترحة).",
  absence_streak_on: "طالب غاب عدة حصص متتالية في نفس المادة. يفتح صفحة الطالب.",
  absence_streak: "عدد الحصص المتتالية التي غاب فيها (بعذر أو بدون).",
  low_attendance_on: "نسبة حضور الطالب في كل المواد أقل من الحد، بعد عدد كافٍ من الحصص.",
  low_attendance_rate: "النسبة المئوية.", low_attendance_min_sessions: "لا يظهر التنبيه قبل هذا العدد من الحصص المسجلة للطالب.",
  unlogged_on: "حصة مضى عليها وقت ولا تسجيل فيها. يفتح الحصة مباشرة.", unlogged_days: "1 = من الأمس وقبل.",
  hw_streak_on: "«غير منجزة» عدة مرات متتالية في نفس المادة.", hw_streak: "عدد المرات المتتالية.",
  disruption_on: "مجموع الشغب خلال الأيام الأخيرة.", disruption_count: "عدد المرات.", disruption_days: "عدد الأيام.",
  below_pass_on: "العلامة حتى الآن في مادة أقل من علامة النجاح. يفتح كشف المادة.",
  drop_on: "علامة أقل بكثير من معدل علامات الطالب السابقة (الإعدادات ← المسار).",
  missing_grades_on: "مضى وقت على تاريخ امتحان وبعض الطلاب بدون علامة. يحتاج تاريخ الامتحان (من رأس العمود في كشف العلامات).",
  missing_grades_days: "عدد الأيام بعد تاريخ الامتحان.",
  drop_points: "علامة أقل بهذا العدد أو أكثر من معدل علامات الطالب السابقة في نفس المادة = هبوط مفاجئ (نقطة حمراء وتنبيه).",
  trend_window: "عدد آخر العلامات التي يُحسب منها الاتجاه.",
  trend_points: "إذا ارتفعت العلامة أكثر من هذا العدد = «يتحسّن»، نزلت أكثر منه = «يتراجع»، وإلا «ثابت».",
};

const LABEL_NAMES: Record<string, string> = {
  p1: "الفصل 1", p2: "الفصل 2", m1: "النصف 1", pr1: "السعي 1", sem1: "معدل النصف 1",
  p3: "الفصل 3", p4: "الفصل 4", m2: "النصف 2", pr2: "السعي 2", sem2: "معدل النصف 2",
  final: "النهائي", term1: "اسم النصف الأول", term2: "اسم النصف الثاني",
};

const ENUMS: Record<string, { v: string; l: string }[]> = {
  theme: [{ v: "system", l: "حسب الجهاز" }, { v: "light", l: "فاتح" }, { v: "dark", l: "داكن" }],
  rounding: [{ v: "round", l: "تقريب عادي" }, { v: "floor", l: "للأسفل" }, { v: "ceil", l: "للأعلى" }],
  missing_policy: [{ v: "nc", l: "إظهار NC (غير مكتمل)" }, { v: "zero", l: "اعتبارها صفراً" }],
  progress_mode: [{ v: "manual", l: "يدوي (يدخله الأستاذ)" }, { v: "behavior", l: "محسوب من السلوك والوظائف" }],
  home: [{ v: "schedule", l: "البرنامج الأسبوعي" }, { v: "classes", l: "قائمة الصفوف" }],
  period: [{ v: "last7", l: "آخر 7 أيام" }, { v: "since_last", l: "منذ آخر رسالة لهذا الطالب" }],
};

const HINTS: Partial<Record<EditableKey, string>> = {
  grading: "معدل النصف = (معدل الفصلين × وزن الفصل + النصف × وزن النصف) ÷ مجموع الوزنين. النهائي = مجموع (كل جزء × وزنه). كل علامة تُحوَّل إلى «العلامة النهائية من» قبل الحساب وعند التصدير. يمكن تعديل الأوزان لكل مادة من كشف العلامات.",
  behavior: "عند اختيار «محسوب من السلوك» في حساب العلامات: السعي = العلامة الأساسية + مجموع النقاط، ضمن 0 والحد الأقصى. القيم السالبة تخصم.",
  visibility: "العلامات غير المحددة هنا لا تظهر للطالب (مفيد لإخفاء امتحان لم يُنشر بعد).",
  whatsapp: "زر واحد يفتح واتساب على رقم الطالب والرسالة مكتوبة. الرسالة للطالب فقط، وأنت تضغط «إرسال» بنفسك.",
  report: "تقرير PDF لكل طالب (صفحة A4): من صفحة الصف ← «تقارير PDF». الشعار والتوقيع من الملف الشخصي.",
  alerts: "تنبيهات الجرس في أعلى الموقع. كل قاعدة يمكن إيقافها، وكل رقم قابل للتعديل. تُرسل أيضاً كملخص في إيميل النسخة الأسبوعية.",
  trajectory: "رسم مسار الطالب في صفحته، والسهم ↑ ↓ → بجانب اسمه.",
};

export default function SettingsPage() {
  return <Suspense fallback={<Spinner />}><SettingsInner /></Suspense>;
}

function SettingsInner() {
  const { settings, loaded } = useSettings();
  const q = useSearchParams();
  const [section, setSection] = useState<EditableKey>(() => {
    const x = q.get("section") as EditableKey | null;
    return x && x in SECTION_TITLES ? x : "grading";
  });
  if (!loaded) return <Spinner />;
  return (
    <div>
      <PageHeader info="كل قيم الموقع هنا: لا شيء ثابت في الكود. اضغط ⓘ بجانب أي خانة لمعرفة ماذا تفعل." title="الإعدادات" sub="كل القيم قابلة للتعديل وتُحفظ في قاعدة البيانات" />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {(Object.keys(SECTION_TITLES) as EditableKey[]).map((k) => (
            <button key={k} onClick={() => setSection(k)}
              className={cx("whitespace-nowrap rounded-lg px-3 py-2 text-right text-sm", section === k ? "bg-brand-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800")}>
              {SECTION_TITLES[k]}
            </button>
          ))}
        </nav>
        <SectionEditor key={section} k={section} initial={settings[section]} />
      </div>
    </div>
  );
}

type CalcKey = "grading" | "behavior";
const isCalc = (k: EditableKey): k is CalcKey => k === "grading" || k === "behavior";

function SectionEditor<K extends EditableKey>({ k, initial }: { k: K; initial: Settings[K] }) {
  const { save, reset, settings } = useSettings();
  const [askScope, setAskScope] = useState(false);
  const L = settings.labels;
  const cur = semesterFor(today(), settings);
  const termName = (n: 1 | 2 | string) => (String(n) === "1" ? L.term1 : L.term2);
  const overrides = (settings.semester_overrides ?? {}) as Record<string, SemesterOverride>;
  const frozen = isCalc(k) ? (["1", "2"] as const).filter((n) => overrides[n]?.[k]) : [];

  async function saveOverrides(ov: Record<string, SemesterOverride>) {
    for (const n of Object.keys(ov)) if (!ov[n] || Object.keys(ov[n]).length === 0) delete ov[n];
    return save("semester_overrides", ov as Settings["semester_overrides"]);
  }

  /** تطبيق تغيير حساب العلامات: على النصف الحالي فقط أو على السنة كلها. */
  async function applyCalc(scope: "current" | "year") {
    if (!isCalc(k)) return;
    setAskScope(false);
    const ov = structuredClone(overrides);
    if (scope === "year") {
      for (const n of ["1", "2"]) if (ov[n]) delete ov[n][k];
    } else {
      const other = cur === 1 ? "2" : "1";
      // النصف الآخر يبقى على إعداداته الحالية (تُحفظ كما هي)
      if (!ov[other]?.[k]) ov[other] = { ...(ov[other] ?? {}), [k]: structuredClone(settings[k]) };
      if (ov[String(cur)]) delete ov[String(cur)][k];
    }
    const err = (await save(k, v as Settings[K])) ?? (await saveOverrides(ov));
    toast(err ? { text: err, kind: "err" } : { text: scope === "year" ? "طُبّق التغيير على السنة كلها" : `طُبّق التغيير على ${termName(cur)} فقط`, kind: "ok" });
    if (!err) setDirty(false);
  }

  async function unfreeze(n: "1" | "2") {
    if (!isCalc(k)) return;
    const ov = structuredClone(overrides);
    if (ov[n]) delete ov[n][k];
    const err = await saveOverrides(ov);
    toast(err ? { text: err, kind: "err" } : { text: `${termName(n)} يستعمل الآن الإعدادات الحالية`, kind: "ok" });
  }
  const toast = useToast();
  const [v, setV] = useState<Record<string, unknown>>(structuredClone(initial) as Record<string, unknown>);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setV(structuredClone(initial) as Record<string, unknown>); setDirty(false); }, [initial]);

  const set = (key: string, val: unknown) => { setV((o) => ({ ...o, [key]: val })); setDirty(true); };

  async function onSave() {
    const bad = validateSection(k, v, settings);
    if (bad) return toast({ text: bad, kind: "err" });
    if (k === "grading") {
      const g = v as Settings["grading"];
      const sum = Number(g.sem1_weight) + Number(g.sem2_weight) + Number(g.progress1_weight) + Number(g.progress2_weight);
      if (Math.abs(sum - 1) > 0.001 && !confirmAction(`مجموع أوزان النهائي = ${sum} (وليس 1). سيتم تقسيم النتيجة على المجموع. متابعة؟`)) return;
    }
    if (isCalc(k)) { setAskScope(true); return; }
    const err = await save(k, v as Settings[K]);
    toast(err ? { text: err, kind: "err" } : { text: "تم حفظ الإعدادات", kind: "ok" });
    if (!err) setDirty(false);
  }
  async function onReset() {
    if (!confirmAction(`إعادة «${SECTION_TITLES[k]}» إلى القيم الافتراضية؟${isCalc(k) ? " (على السنة كلها)" : ""}`)) return;
    let err = await reset(k);
    if (!err && isCalc(k) && frozen.length) {
      const ov = structuredClone(overrides);
      for (const n of frozen) delete ov[n][k];
      err = await saveOverrides(ov);
    }
    toast(err ? { text: err, kind: "err" } : { text: "تمت الإعادة", kind: "ok" });
  }

  const def = DEFAULT_SETTINGS[k] as Record<string, unknown>;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center text-lg font-semibold">{SECTION_TITLES[k]}<Info title="الحفظ وإعادة الافتراضي">لا يُحفظ أي تغيير قبل الضغط على «حفظ». «إعادة للافتراضي» يرجع هذا القسم فقط إلى القيم الأصلية.{isCalc(k) ? " عند حفظ هذا القسم يسألك الموقع: هل يطبَّق التغيير على النصف الحالي فقط أم على السنة كلها." : ""}</Info></h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>إعادة للافتراضي</Button>
          <Button size="sm" disabled={!dirty} onClick={onSave}>حفظ</Button>
        </div>
      </div>
      {HINTS[k] && <p className="mb-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">{HINTS[k]}</p>}

      {frozen.map((n) => (
        <div key={n} className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="flex-1">⚠ {termName(n)} يُحسب بإعدادات سابقة محفوظة (القيم أدناه تخص {frozen.length === 2 ? "الإعدادات العامة" : termName(n === "1" ? 2 : 1)}).</span>
          <Button size="sm" variant="secondary" onClick={() => confirmAction(`تطبيق الإعدادات الحالية على ${termName(n)}؟ ستتغير علاماته المحسوبة.`) && unfreeze(n)}>طبّق الإعدادات الحالية عليه</Button>
        </div>
      ))}

      {k === "data" && <DataTools />}
      {k === "profile" && <ReportImages />}

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.keys(def).map((key) => {
          const val = v[key];
          const label = k === "labels" ? LABEL_NAMES[key] ?? `${(DEFAULT_SETTINGS.labels as Record<string, string>)[key]}` : FIELD_LABELS[key] ?? key;

          if (key === "weekend_days") {
            const arr = (val as number[]) ?? [];
            return (
              <Field key={key} label="أيام العطلة الأسبوعية" info={FIELD_INFO.weekend_days}>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <button key={i} type="button" onClick={() => set(key, arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i])}
                      className={cx("rounded-md px-2 py-1 text-xs", arr.includes(i) ? "bg-brand-500 text-white" : "bg-zinc-100 dark:bg-zinc-800")}>{d}</button>
                  ))}
                </div>
              </Field>
            );
          }
          if (key === "breaks") return <BreaksEditor key={key} value={val as Settings["year"]["breaks"]} onChange={(x) => set(key, x)} />;
          if (key === "bands") return <BandsEditor key={key} value={val as Settings["grading"]["bands"]} onChange={(x) => set(key, x)} />;
          if (key === "components") {
            const arr = (val as string[]) ?? [];
            return (
              <Field key={key} label="العلامات الظاهرة للطالب" info={FIELD_INFO.components}>
                <div className="flex flex-wrap gap-1">
                  {COMPONENTS.map((c) => (
                    <button key={c} type="button" onClick={() => set(key, arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c])}
                      className={cx("rounded-md px-2 py-1 text-xs", arr.includes(c) ? "bg-brand-500 text-white" : "bg-zinc-100 line-through dark:bg-zinc-800")}>
                      {(L as Record<string, string>)[c]}
                    </button>
                  ))}
                </div>
              </Field>
            );
          }
          if (ENUMS[key]) {
            return (
              <Field key={key} label={label} info={k === "labels" ? "غيّر الاسم كما تريد أن يظهر في كل الموقع وفي التصدير وصفحة الطالب." : FIELD_INFO[key]}>
                <Select className="w-full" value={String(val)} onChange={(e) => set(key, e.target.value)}>
                  {ENUMS[key].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </Select>
              </Field>
            );
          }
          if (typeof def[key] === "boolean") {
            return (
              <label key={key} className={cx("flex items-center gap-2 text-sm", k === "alerts" && "mt-2 border-t border-zinc-100 pt-3 font-semibold first:mt-0 first:border-0 first:pt-0 sm:col-span-2 dark:border-zinc-800")}>
                <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={!!val} onChange={(e) => set(key, e.target.checked)} />
                {label}{FIELD_INFO[key] && <Info title={label}>{FIELD_INFO[key]}</Info>}
              </label>
            );
          }
          if (typeof def[key] === "number") {
            return (
              <Field key={key} label={label} info={k === "labels" ? "غيّر الاسم كما تريد أن يظهر في كل الموقع وفي التصدير وصفحة الطالب." : FIELD_INFO[key]}>
                <Input type="number" step="any" value={val as number} onChange={(e) => set(key, e.target.value === "" ? 0 : Number(e.target.value))} />
              </Field>
            );
          }
          if (key === "template") {
            return (
              <Field key={key} label={label} info={FIELD_INFO[key]}>
                <textarea rows={8} value={(val as string) ?? ""} onChange={(e) => set(key, e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm leading-7 dark:border-zinc-700 dark:bg-zinc-900" />
              </Field>
            );
          }
          if (key === "logo_url") return null; // الشعار يُرفع كصورة أدناه
          const isDate = ["start", "sem1_end", "end"].includes(key);
          return (
            <Field key={key} label={label} info={k === "labels" ? "غيّر الاسم كما تريد أن يظهر في كل الموقع وفي التصدير وصفحة الطالب." : FIELD_INFO[key]}>
              <Input type={isDate ? "date" : "text"} value={(val as string) ?? ""} onChange={(e) => set(key, e.target.value)} />
            </Field>
          );
        })}
      </div>

      <Modal open={askScope} onClose={() => setAskScope(false)} title="تطبيق التغيير على حساب العلامات">
        <p className="mb-4 text-sm leading-7 text-zinc-600 dark:text-zinc-300">
          هل تريد إعادة حساب العلامات بالإعدادات الجديدة؟ النصف الحالي هو <b>{termName(cur)}</b>.
        </p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => applyCalc("current")}>{termName(cur)} فقط <span className="text-xs opacity-80">— {termName(cur === 1 ? 2 : 1)} يبقى كما هو</span></Button>
          <Button variant="secondary" onClick={() => applyCalc("year")}>السنة كلها (النصفين)</Button>
          <Button variant="ghost" onClick={() => setAskScope(false)}>لا، لا تغيّر شيئاً</Button>
        </div>
      </Modal>
    </Card>
  );
}

function BreaksEditor({ value, onChange }: { value: Settings["year"]["breaks"]; onChange: (v: Settings["year"]["breaks"]) => void }) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center text-sm font-medium">العطل<Info title="العطل">{FIELD_INFO.breaks}</Info></div>
      <div className="space-y-2">
        {value.map((b, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Input className="w-40" placeholder="الاسم" value={b.label} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input className="w-40" type="date" value={b.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <Input className="w-40" type="date" value={b.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => onChange([...value, { label: "", from: "", to: "" }])}>+ عطلة</Button>
      </div>
    </div>
  );
}

function BandsEditor({ value, onChange }: { value: Settings["grading"]["bands"]; onChange: (v: Settings["grading"]["bands"]) => void }) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center text-sm font-medium">سلّم التقديرات (من الحد الأدنى وما فوق)<Info title="سلّم التقديرات">{FIELD_INFO.bands}</Info></div>
      <div className="space-y-2">
        {value.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input className="w-24" type="number" step="any" value={b.min} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} />
            <Input className="w-40" value={b.label} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input className="h-9 w-14 p-1" type="color" value={b.color} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => onChange([...value, { min: 0, label: "", color: "#666666" }])}>+ تقدير</Button>
      </div>
    </div>
  );
}


function DataTools() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function exportAll() {
    setBusy(true);
    const out: Record<string, unknown[]> = {};
    for (const t of BACKUP_TABLES) {
      const all: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase().from(t).select("*").range(from, from + 999);
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      out[t] = all;
    }
    downloadJson({ version: BACKUP_VERSION, exported_at: new Date().toISOString(), tables: out }, `نسخة-احتياطية-${new Date().toISOString().slice(0, 10)}.json`);
    setBusy(false);
  }

  async function importAll(file?: File) {
    if (!file) return;
    if (!confirmAction("سيتم دمج النسخة الاحتياطية مع البيانات الحالية (السجلات بنفس المعرّف ستُستبدل). متابعة؟")) return;
    setBusy(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("الملف كبير جداً");
      let json: { version?: number; tables: Record<string, Record<string, unknown>[]> };
      try { json = JSON.parse(await file.text()); } catch { throw new Error("الملف ليس نسخة احتياطية صالحة (JSON)"); }
      if (!json || typeof json !== "object" || !json.tables || typeof json.tables !== "object") throw new Error("الملف لا يحتوي على جداول النسخة الاحتياطية");
      for (const t of Object.keys(json.tables)) if (!Array.isArray(json.tables[t])) throw new Error(`الجدول ${t} غير صالح`);
      const { data: u } = await supabase().auth.getUser();
      for (const t of BACKUP_TABLES) {
        const rows = (json.tables[t] ?? []).map((r) => ({ ...r, owner_id: u.user!.id }));
        for (let i = 0; i < rows.length; i += 500) {
          const conflict = t === "settings" || t === "alert_states" ? "owner_id,key" : "id";
          const { error } = await supabase().from(t).upsert(rows.slice(i, i + 500), { onConflict: conflict });
          if (error) throw new Error(`${t}: ${error.message}`);
        }
      }
      toast({ text: "تم استيراد النسخة الاحتياطية", kind: "ok" });
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast({ text: "فشل الاستيراد: " + friendly(e), kind: "err" });
    }
    setBusy(false);
  }

  return (
    <div className="mb-6 space-y-4 border-b border-zinc-100 pb-6 dark:border-zinc-800">
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={exportAll}>تصدير كل البيانات (نسخة احتياطية)</Button>
      <label className={cx("inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800", busy && "opacity-50")}>
        استيراد نسخة احتياطية
        <input type="file" accept=".json" className="hidden" onChange={(e) => importAll(e.target.files?.[0])} />
      </label>
    </div>
    <KeepaliveStatus />
    <ErrorLog />
    </div>
  );
}

/** «آخر نبضة»: المهمة المجدولة على GitHub تلمس قاعدة البيانات كل يومين حتى لا يتوقف Supabase المجاني. */
function KeepaliveStatus() {
  const [at, setAt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    supabase().from("keepalive").select("beat_at").maybeSingle().then(({ data, error }) => setAt(error ? null : (data?.beat_at as string) ?? null));
  }, []);
  if (at === undefined) return null;
  const days = at ? (Date.now() - new Date(at).getTime()) / 864e5 : null;
  const ago = days === null ? "" : days < 1 ? "اليوم" : days < 2 ? "قبل يوم" : `قبل ${Math.floor(days)} أيام`;
  const bad = days === null || days > 4;
  return (
    <div className={cx("flex flex-wrap items-center gap-2 rounded-lg p-3 text-sm", bad ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300" : "bg-zinc-50 text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300")}>
      <span>آخر نبضة: <b>{at ? `${ago} (${new Date(at).toLocaleString("ar-LB")})` : "لم تصل أي نبضة بعد"}</b></span>
      <Info title="منع توقف Supabase">Supabase المجاني يوقف المشروع بعد 7 أيام بدون نشاط. مهمة «keepalive» على GitHub تلمس قاعدة البيانات كل يومين. إذا ظهرت بالأحمر (أكثر من 4 أيام): افتح GitHub ← Actions ← Keepalive ← Run workflow. والنسخة الأسبوعية بالإيميل هي شبكة الأمان الثانية.</Info>
    </div>
  );
}

/** الشعار والتوقيع: صورتان مصغّرتان (أقل من 150 كيلوبايت) تُحفظان في الإعدادات نفسها. */
function ReportImages() {
  const { settings, save } = useSettings();
  const toast = useToast();
  const imgs = settings.report_images;
  async function pick(kind: "logo" | "signature", file?: File) {
    if (!file) return;
    try {
      const url = await shrinkImage(file, kind === "signature" ? 500 : 400);
      const err = await save("report_images", { ...imgs, [kind]: url });
      toast(err ? { text: err, kind: "err" } : { text: kind === "logo" ? "حُفظ الشعار" : "حُفظ التوقيع", kind: "ok" });
    } catch (e) {
      toast({ text: (e as Error).message, kind: "err" });
    }
  }
  async function clear(kind: "logo" | "signature") {
    const err = await save("report_images", { ...imgs, [kind]: "" });
    if (err) toast({ text: err, kind: "err" });
  }
  const box = (kind: "logo" | "signature", label: string, info: string) => (
    <div className="space-y-2">
      <div className="flex items-center text-sm font-medium">{label}<Info title={label}>{info}</Info></div>
      <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/40">
        {imgs[kind] ? <img src={imgs[kind]} alt={label} className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-zinc-400">لا توجد صورة</span>}
      </div>
      <div className="flex gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          رفع صورة<input type="file" accept="image/*" className="hidden" onChange={(e) => pick(kind, e.target.files?.[0])} />
        </label>
        {imgs[kind] && <Button size="sm" variant="ghost" onClick={() => clear(kind)}>حذف</Button>}
      </div>
    </div>
  );
  return (
    <div className="mb-6 grid gap-4 border-b border-zinc-100 pb-6 sm:grid-cols-2 dark:border-zinc-800">
      {box("logo", "شعار المدرسة", "يظهر في التقرير المطبوع وفي صفحة علامات الطالب. يُصغّر تلقائياً.")}
      {box("signature", "توقيع الأستاذ", "يظهر فقط في التقرير المطبوع، ولا يظهر أبداً في صفحة الطالب على الإنترنت. يفضّل صورة بخلفية بيضاء أو شفافة.")}
    </div>
  );
}

/** تصغير صورة في المتصفح حتى أقل من 150 كيلوبايت (PNG للشفافية، وإلا JPEG). */
async function shrinkImage(file: File, maxSide: number): Promise<string> {
  const src = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("تعذّرت قراءة الصورة")); r.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("الملف ليس صورة")); i.src = src; });
  const LIMIT = 150 * 1024 * 1.37; // حجم base64
  for (let side = maxSide; side >= 120; side = Math.round(side * 0.8)) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const png = c.toDataURL("image/png");
    if (png.length < LIMIT) return png;
    const jpg = c.toDataURL("image/jpeg", 0.85);
    if (jpg.length < LIMIT) return jpg;
  }
  throw new Error("الصورة كبيرة جداً");
}

/** «سجل الأخطاء»: آخر الأخطاء على هذا الجهاز (بدون بيانات طلاب)، لنسخها عند طلب المساعدة. */
function ErrorLog() {
  const toast = useToast();
  const [list, setList] = useState<LoggedError[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { setList(readErrors()); }, [open]);
  return (
    <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
      <div className="flex flex-wrap items-center gap-2">
        <span>سجل الأخطاء على هذا الجهاز: <b>{list.length}</b></span>
        <Info title="سجل الأخطاء">إذا حدثت مشكلة، يُسجَّل الخطأ هنا (الرسالة والصفحة والوقت فقط، بدون أسماء أو علامات). انسخه وأرسله عند طلب المساعدة.</Info>
        <div className="flex-1" />
        {list.length > 0 && <>
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "إخفاء" : "عرض"}</Button>
          <Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(list, null, 2)); toast({ text: "نُسخ السجل", kind: "ok" }); } catch { toast({ text: "تعذّر النسخ", kind: "err" }); } }}>نسخ</Button>
          <Button size="sm" variant="ghost" onClick={() => { clearErrors(); setList([]); }}>مسح</Button>
        </>}
      </div>
      {open && (
        <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto text-xs" dir="ltr">
          {list.map((e, i) => <li key={i} className="font-mono text-zinc-600 dark:text-zinc-400">{e.at.slice(0, 19).replace("T", " ")} {e.page} — {e.message}</li>)}
        </ul>
      )}
    </div>
  );
}
