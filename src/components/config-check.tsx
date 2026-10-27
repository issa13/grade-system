"use client";
import { supabaseConfigured } from "@/lib/supabase/client";

/** بدل أن تتعطل الصفحة، تظهر رسالة واضحة إذا لم تُضبط قيم Supabase أثناء البناء. */
export function ConfigCheck({ children }: { children: React.ReactNode }) {
  if (supabaseConfigured) return <>{children}</>;
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
        <h1 className="mb-3 text-xl font-bold">الموقع غير مربوط بقاعدة البيانات بعد</h1>
        <p className="mb-3 text-sm leading-7">
          لم يتم العثور على عنوان Supabase والمفتاح أثناء بناء الموقع. أضفهما ثم أعد النشر:
        </p>
        <ol className="list-decimal space-y-1 ps-5 text-sm leading-7">
          <li>على GitHub: <b>Settings ← Secrets and variables ← Actions ← Variables</b></li>
          <li>أضف <code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و <code dir="ltr">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (تبويب Variables وليس Secrets)</li>
          <li>من تبويب <b>Actions</b> ← <b>Deploy to GitHub Pages</b> ← <b>Run workflow</b></li>
        </ol>
        <p className="mt-3 text-xs opacity-75">عند التشغيل على الجهاز: ضع القيمتين في ملف <code dir="ltr">.env.local</code> وأعد تشغيل <code dir="ltr">npm run dev</code>.</p>
      </div>
    </main>
  );
}
