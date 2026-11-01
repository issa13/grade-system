// المسار الأساسي للموقع. على GitHub Pages يكون عادةً "/اسم-المستودع".
// يُضبط تلقائياً أثناء النشر عبر NEXT_PUBLIC_BASE_PATH.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// عنوان الموقع المنشور. فارغ في الموقع نفسه، ويُضبط فقط عند بناء تطبيق أندرويد
// (mobile/scripts/copy-web.js): داخل التطبيق تُفتح الصفحات من التلفون نفسه
// (https://localhost)، فرابط الطالب وروابط الإيميلات يجب أن تشير إلى الموقع الحقيقي.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

/** رابط كامل لصفحة داخل الموقع (مع اسم النطاق والمسار الأساسي). */
export function absoluteUrl(path: string): string {
  if (SITE_URL) return `${SITE_URL}${path}`;
  return `${window.location.origin}${BASE_PATH}${path}`;
}
