// المسار الأساسي للموقع. على GitHub Pages يكون عادةً "/اسم-المستودع".
// يُضبط تلقائياً أثناء النشر عبر NEXT_PUBLIC_BASE_PATH.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** رابط كامل لصفحة داخل الموقع (مع اسم النطاق والمسار الأساسي). */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}${BASE_PATH}${path}`;
}
