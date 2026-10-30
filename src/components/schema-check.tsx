"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

/** رقم نسخة قاعدة البيانات الذي يحتاجه هذا الإصدار من الموقع. */
export const REQUIRED_SCHEMA = 4;

/**
 * إذا نسي الأستاذ تشغيل ملف تحديث في Supabase، تتعطل ميزات بدون رسالة واضحة.
 * هذا الشريط يقول له بالضبط أي ملف يشغّل.
 */
export function SchemaCheck() {
  const [missing, setMissing] = useState<string[] | null>(null);
  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    (async () => {
      try {
        const sb = supabase();
        const { data, error } = await sb.rpc("app_schema_version");
        if (!error && Number(data) >= REQUIRED_SCHEMA) return setMissing([]);
        if (error && (error as { status?: number }).status === 0) return; // بدون إنترنت
        const files: string[] = [];
        const k = await sb.from("keepalive").select("id").limit(1);
        if (k.error && (k.status === 404 || /does not exist|PGRST205|schema cache/i.test(k.error.message))) files.push("002_v2.sql");
        const v = error ? 0 : Number(data);
        if (v < 3) files.push("003_student_stats.sql");
        files.push("004_push.sql");
        setMissing(files);
      } catch { /* لا شيء */ }
    })();
  }, []);
  if (!missing?.length) return null;
  return (
    <div className="no-print mb-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
      <b>قاعدة البيانات تحتاج تحديثاً.</b> بعض الميزات لن تعمل قبل ذلك. افتح Supabase ← <b>SQL Editor</b> وشغّل بالترتيب:
      {" "}{missing.map((f) => <code key={f} dir="ltr" className="mx-1 rounded bg-white px-1.5 py-0.5 text-xs dark:bg-zinc-900">supabase/migrations/{f}</code>)}
    </div>
  );
}
