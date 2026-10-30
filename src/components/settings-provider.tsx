"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { logError } from "@/lib/errors";
import { DEFAULT_SETTINGS, mergeSettings, subjectKey, type Settings, type SettingsKey, type SubjectWeights } from "@/lib/settings";

type Ctx = {
  settings: Settings;
  loaded: boolean;
  save: <K extends SettingsKey>(key: K, value: Settings[K]) => Promise<string | null>;
  reset: (key: SettingsKey) => Promise<string | null>;
  /** أوزان خاصة بكل مادة (subject_id → أوزان) */
  subjectWeights: Record<string, SubjectWeights>;
  saveSubjectWeights: (subjectId: string, w: SubjectWeights | null) => Promise<string | null>;
};

const SettingsCtx = createContext<Ctx>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  save: async () => null,
  reset: async () => null,
  subjectWeights: {},
  saveSubjectWeights: async () => null,
});
export const useSettings = () => useContext(SettingsCtx);

export function applyTheme(theme: Settings["profile"]["theme"]) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem("theme", theme); } catch {}
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [subjectWeights, setSubjectWeights] = useState<Record<string, SubjectWeights>>({});

  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase().from("settings").select("key,value");
      // بدون الإعدادات الحقيقية تكون كل العلامات المحسوبة خاطئة: لا نكمل بالقيم الافتراضية بصمت
      if (error) { logError(error.message, "settings"); setFailed(true); return; }
      setFailed(false);
      const obj: Record<string, unknown> = {};
      (data ?? []).forEach((r: { key: string; value: unknown }) => (obj[r.key] = r.value));
      const sw: Record<string, SubjectWeights> = {};
      for (const [k, v] of Object.entries(obj)) if (k.startsWith("subject:")) sw[k.slice(8)] = v as SubjectWeights;
      setSubjectWeights(sw);
      const s = mergeSettings(obj);
      setSettings(s);
      setLoaded(true);
      applyTheme(s.profile.theme);
      // تفريغ سلة المحذوفات القديمة (مرة في اليوم كحد أقصى)
      try {
        const day = new Date().toISOString().slice(0, 10);
        if (navigator.onLine && localStorage.getItem("trashPurged") !== day) {
          const cutoff = new Date(Date.now() - Math.max(1, s.data.trash_retention_days) * 864e5).toISOString();
          for (const t of ["students", "subjects", "sessions", "assignments", "classes"]) {
            await supabase().from(t).delete().lt("deleted_at", cutoff);
          }
          localStorage.setItem("trashPurged", day);
        }
      } catch (e) { logError(e, "trash"); }
    })();
  }, [retry]);

  const save = useCallback(async <K extends SettingsKey>(key: K, value: Settings[K]) => {
    const { data: u } = await supabase().auth.getUser();
    if (!u.user) return "غير مسجل الدخول";
    const { error } = await supabase()
      .from("settings")
      .upsert({ owner_id: u.user.id, key, value, updated_at: new Date().toISOString() });
    if (error) return error.message;
    setSettings((s) => ({ ...s, [key]: value }));
    if (key === "profile") applyTheme((value as Settings["profile"]).theme);
    return null;
  }, []);

  const reset = useCallback(async (key: SettingsKey) => {
    const { error } = await supabase().from("settings").delete().eq("key", key);
    if (error) return error.message;
    setSettings((s) => ({ ...s, [key]: structuredClone(DEFAULT_SETTINGS[key]) }));
    if (key === "profile") applyTheme(DEFAULT_SETTINGS.profile.theme);
    return null;
  }, []);

  const saveSubjectWeights = useCallback(async (subjectId: string, w: SubjectWeights | null) => {
    const { data: u } = await supabase().auth.getUser();
    if (!u.user) return "غير مسجل الدخول";
    const key = subjectKey(subjectId);
    const { error } = w
      ? await supabase().from("settings").upsert({ owner_id: u.user.id, key, value: w, updated_at: new Date().toISOString() })
      : await supabase().from("settings").delete().eq("key", key);
    if (error) return error.message;
    setSubjectWeights((m) => {
      const n = { ...m };
      if (w) n[subjectId] = w;
      else delete n[subjectId];
      return n;
    });
    return null;
  }, []);

  if (failed) return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <p className="font-semibold">تعذّر تحميل الإعدادات.</p>
        <p className="mt-1">{navigator.onLine ? "حاول مجدداً بعد قليل." : "لا يوجد اتصال، ولا توجد نسخة محفوظة على هذا الجهاز بعد. افتح الموقع مرة مع إنترنت ليعمل بعدها بدون اتصال."}</p>
        <button className="mt-3 rounded-lg bg-brand-500 px-4 py-2 text-white" onClick={() => setRetry((x) => x + 1)}>إعادة المحاولة</button>
      </div>
    </div>
  );
  return <SettingsCtx.Provider value={{ settings, loaded, save, reset, subjectWeights, saveSubjectWeights }}>{children}</SettingsCtx.Provider>;
}

/** إعدادات ثابتة بدون قاعدة بيانات (صفحة الطالب): حتى تعمل نفس مكوّنات الإحصائيات. */
export function StaticSettingsProvider({ settings, children }: { settings: Settings; children: ReactNode }) {
  return <SettingsCtx.Provider value={{ settings, loaded: true, save: async () => null, reset: async () => null, subjectWeights: {}, saveSubjectWeights: async () => null }}>{children}</SettingsCtx.Provider>;
}
