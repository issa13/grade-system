// رسائل واتساب للطلاب: تنسيق الأرقام، ملء القالب، وحساب أرقام الفترة.
import type { SubjectGrades } from "./class-data";
import { scoreOf } from "./stats";
import type { Settings } from "./settings";
import type { Subject } from "./types";

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const latinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));

/**
 * يقبل الرقم بأي شكل ويحوّله للصيغة الدولية بدون + (مثلاً 9613123456).
 * 03 123 456 · 03123456 · +961 3 123456 · 009613123456 · 9613123456 ← كلها نفس النتيجة.
 * يعيد null إذا لم يكن رقماً صالحاً.
 */
export function normalizePhone(raw: string | null | undefined, countryCode = "961"): string | null {
  if (!raw) return null;
  const t = latinDigits(String(raw)).trim();
  const cc = countryCode.replace(/\D/g, "") || "961";
  let d = t.replace(/\D/g, "");
  if (!d) return null;
  const intl = t.startsWith("+") || t.startsWith("00");
  if (t.startsWith("00")) d = d.slice(2);
  if (!intl) {
    if (d.startsWith(cc) && d.length >= cc.length + 7) { /* مكتوب دولياً بدون + */ }
    else if (d.startsWith("0")) d = cc + d.slice(1);
    else d = cc + d;
  }
  if (d.startsWith(cc + "0")) d = cc + d.slice(cc.length + 1); // +961 03… ← +961 3…
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** عرض الرقم بشكل مقروء: +961 3 123 456 */
export function prettyPhone(p: string | null | undefined, countryCode = "961"): string {
  if (!p) return "";
  const cc = countryCode.replace(/\D/g, "");
  if (cc && p.startsWith(cc)) {
    const rest = p.slice(cc.length);
    const head = rest.length === 7 ? rest.slice(0, 1) : rest.slice(0, 2);
    const tail = rest.slice(head.length);
    return `+${cc} ${head} ${tail.slice(0, 3)} ${tail.slice(3)}`.trim();
  }
  return `+${p}`;
}

export const PLACEHOLDERS = ["الاسم", "الصف", "غياب", "تأخير", "مشاركة", "شغب", "وظائف_ناقصة", "المعدل", "مواد_تحت_النجاح", "الرابط", "اسم_الأستاذ", "اسم_المدرسة"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** ملء القالب. السطر الذي فيه خانة فارغة يُحذف كله (مثلاً لا توجد مواد تحت النجاح). */
export function fillTemplate(template: string, values: Partial<Record<Placeholder, string | number | null | undefined>>): string {
  const lines = template.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    let empty = false;
    const filled = line.replace(/\{([^{}]+)\}/g, (m, k: string) => {
      const key = k.trim() as Placeholder;
      if (!(PLACEHOLDERS as readonly string[]).includes(key)) return m;
      const v = values[key];
      if (v === null || v === undefined || String(v).trim() === "") { empty = true; return ""; }
      return String(v);
    });
    if (!empty) out.push(filled);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type PeriodStats = { absent: number; late: number; participation: number; disruption: number; hwMissing: number; sessions: number };

/** أرقام الطالب في فترة (كل المواد): من تسجيل الحصص ومن الواجبات المستحقة في الفترة. */
export function periodStats(studentId: string, subjects: Subject[], data: Record<string, SubjectGrades>, from: string, to: string): PeriodStats {
  const p: PeriodStats = { absent: 0, late: 0, participation: 0, disruption: 0, hwMissing: 0, sessions: 0 };
  for (const sj of subjects) {
    const d = data[sj.id];
    if (!d) continue;
    const live = new Set((d.sessions ?? []).filter((s) => !s.cancelled && !s.deleted_at && s.date >= from && s.date <= to).map((s) => s.id));
    for (const r of d.records ?? []) {
      if (r.student_id !== studentId || !live.has(r.session_id)) continue;
      p.sessions++;
      if (r.absence) p.absent++;
      if (r.late) p.late++;
      p.participation += Number(r.participation) || 0;
      p.disruption += Number(r.disruption) || 0;
      if (r.homework === "missing") p.hwMissing++;
    }
    const due = new Set((d.assignments ?? []).filter((a) => !a.deleted_at && a.due_date && a.due_date >= from && a.due_date <= to).map((a) => a.id));
    for (const s of d.submissions ?? []) if (s.student_id === studentId && due.has(s.assignment_id) && s.status === "missing") p.hwMissing++;
  }
  return p;
}

/** «الرياضيات 9، الفيزياء 8» */
export function failingSubjects(studentId: string, subjects: Subject[], data: Record<string, SubjectGrades>, s: Settings): string {
  return subjects
    .map((sj) => ({ sj, v: scoreOf(data[sj.id]?.rows[studentId]) }))
    .filter((x) => x.v !== null && x.v < s.grading.pass_mark)
    .map((x) => `${x.sj.name} ${x.v}`)
    .join("، ");
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent));
}

/** على التلفون يفتح تطبيق واتساب، وعلى الكمبيوتر WhatsApp Web. */
export function waLink(phone: string, text: string, mobile = isMobileDevice()): string {
  const t = encodeURIComponent(text);
  return mobile ? `https://wa.me/${phone}?text=${t}` : `https://web.whatsapp.com/send?phone=${phone}&text=${t}`;
}
