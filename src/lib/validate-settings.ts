// التحقق من قيم الإعدادات قبل الحفظ (قيمة خاطئة واحدة قد تفسد كل العلامات المحسوبة).
import type { EditableKey, Settings } from "./settings";

type V = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export function validateSection(k: EditableKey, v: V, s: Settings): string | null {
  for (const [key, val] of Object.entries(v)) {
    if (typeof val === "number" && !Number.isFinite(val)) return `قيمة غير صالحة في «${key}»`;
  }
  const between = (key: string, lo: number, hi: number, label: string) => {
    const x = num(v[key]);
    return Number.isNaN(x) || x < lo || x > hi ? `${label} يجب أن يكون بين ${lo} و ${hi}` : null;
  };
  const first = (...errs: (string | null)[]) => errs.find(Boolean) ?? null;
  switch (k) {
    case "grading": {
      const scale = num(v.scale);
      const bands = (v.bands as { min: number; label: string }[]) ?? [];
      return first(
        between("scale", 1, 1000, "العلامة النهائية"),
        between("max_periodic", 1, 1000, "علامة الفصل"),
        between("max_midterm", 1, 1000, "علامة النصف"),
        between("max_progress", 1, 1000, "علامة السعي"),
        between("periodic_weight", 0, 1000, "وزن الفصلين"),
        between("midterm_weight", 0, 1000, "وزن النصف"),
        num(v.periodic_weight) + num(v.midterm_weight) <= 0 ? "وزن الفصلين + وزن النصف يجب أن يكون أكبر من صفر" : null,
        ...["sem1_weight", "sem2_weight", "progress1_weight", "progress2_weight"].map((x) => between(x, 0, 100, "الأوزان")),
        between("decimals", 0, 4, "عدد الخانات العشرية"),
        Number.isInteger(num(v.decimals)) ? null : "عدد الخانات العشرية يجب أن يكون عدداً صحيحاً",
        between("pass_mark", 0, scale, "علامة النجاح"),
        bands.some((b) => !String(b.label ?? "").trim()) ? "كل تقدير يحتاج اسماً" : null,
        bands.some((b) => !(b.min >= 0 && b.min <= scale)) ? `الحد الأدنى لكل تقدير يجب أن يكون بين 0 و ${scale}` : null,
        new Set(bands.map((b) => b.min)).size !== bands.length ? "يوجد تقديران بنفس الحد الأدنى" : null,
      );
    }
    case "behavior":
      return first(between("base", 0, s.grading.max_progress, "علامة السعي الأساسية"), between("participation_max_per_session", 0, 50, "أقصى عدد مشاركات"));
    case "year": {
      const breaks = (v.breaks as { from: string; to: string; label: string }[]) ?? [];
      const wk = (v.weekend_days as number[]) ?? [];
      return first(
        !v.start || !v.sem1_end || !v.end ? "تواريخ السنة مطلوبة" : null,
        String(v.start) < String(v.sem1_end) && String(v.sem1_end) < String(v.end) ? null : "يجب أن تكون: بداية السنة < نهاية النصف الأول < نهاية السنة",
        breaks.some((b) => !b.from || !b.to || b.from > b.to) ? "كل عطلة تحتاج تاريخ بداية ≤ تاريخ نهاية" : null,
        wk.length >= 7 ? "لا يمكن أن تكون كل الأيام عطلة" : null,
      );
    }
    case "schedule":
      return first(between("now_before_minutes", 0, 120, "«الآن» قبل الحصة"), between("now_after_minutes", 0, 180, "«الآن» بعد الحصة"));
    case "whatsapp":
      return first(/^\d{1,4}$/.test(String(v.country_code ?? "")) ? null : "مفتاح الدولة أرقام فقط (مثلاً 961)", String(v.template ?? "").trim() ? null : "قالب الرسالة فارغ");
    case "alerts":
      return first(
        between("absence_streak", 1, 50, "عدد الحصص المتتالية"), between("low_attendance_rate", 1, 100, "نسبة الحضور"),
        between("low_attendance_min_sessions", 1, 500, "عدد الحصص"), between("unlogged_days", 0, 60, "عدد الأيام"),
        between("hw_streak", 1, 50, "عدد الوظائف"), between("disruption_count", 1, 100, "عدد مرات الشغب"),
        between("disruption_days", 1, 90, "عدد الأيام"), between("missing_grades_days", 0, 90, "عدد الأيام"),
      );
    case "trajectory":
      return first(between("drop_points", 0.5, s.grading.scale, "الهبوط المفاجئ"), between("trend_window", 2, 10, "عدد العلامات"), between("trend_points", 0, s.grading.scale, "نقاط الاتجاه"));
    case "push": {
      const t = /^([01]\d|2[0-3]):[0-5]\d$/;
      return first(t.test(String(v.quiet_from)) && t.test(String(v.quiet_to)) ? null : "أوقات الهدوء بصيغة 20:00", between("max_per_run", 1, 20, "أقصى عدد إشعارات"));
    }
    case "data":
      return between("trash_retention_days", 1, 365, "مدة الاحتفاظ");
    case "labels":
      return Object.values(v).some((x) => !String(x ?? "").trim()) ? "لا يمكن ترك تسمية فارغة" : null;
    default:
      return null;
  }
}
