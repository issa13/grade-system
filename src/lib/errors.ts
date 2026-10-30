// سجل أخطاء محلي (آخر 50 خطأ) يساعد على معرفة سبب أي مشكلة لاحقاً.
// لا يحتوي على بيانات طلاب: فقط رسالة الخطأ والصفحة والوقت.
const KEY = "errorLog";
export type LoggedError = { at: string; page: string; message: string };

export function logError(e: unknown, where = "") {
  try {
    const message = (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e)).slice(0, 300);
    if (!message || /ResizeObserver loop/.test(message)) return;
    const list: LoggedError[] = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    list.unshift({ at: new Date().toISOString(), page: (where || location.pathname).slice(0, 80), message });
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch { /* لا شيء */ }
}

export function readErrors(): LoggedError[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
export function clearErrors() {
  try { localStorage.removeItem(KEY); } catch { /* لا شيء */ }
}

/** رسالة مفهومة للأستاذ من خطأ Supabase أو الشبكة. */
export function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  if (/fetch|network|load failed/i.test(m)) return "لا يوجد اتصال بالإنترنت";
  if (/jwt|401|not authorized|permission/i.test(m)) return "انتهى تسجيل الدخول — سجّل الدخول مجدداً";
  if (/duplicate key|23505/i.test(m)) return "هذا العنصر موجود مسبقاً";
  if (/violates check constraint/i.test(m)) return "قيمة غير صالحة";
  if (/violates foreign key/i.test(m)) return "العنصر المرتبط غير موجود (ربما حُذف)";
  if (/does not exist|PGRST20[25]/i.test(m)) return "قاعدة البيانات تحتاج تحديثاً (راجع ملفات supabase/migrations)";
  return m || "حدث خطأ غير متوقع";
}
