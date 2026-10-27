"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { DEFAULT_SETTINGS, mergeSettings, type Settings, type SettingsKey } from "@/lib/settings";

type Ctx = {
  settings: Settings;
  loaded: boolean;
  save: <K extends SettingsKey>(key: K, value: Settings[K]) => Promise<string | null>;
  reset: (key: SettingsKey) => Promise<string | null>;
};

const SettingsCtx = createContext<Ctx>({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  save: async () => null,
  reset: async () => null,
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

  useEffect(() => {
    (async () => {
      const { data } = await supabase().from("settings").select("key,value");
      const obj: Record<string, unknown> = {};
      (data ?? []).forEach((r: { key: string; value: unknown }) => (obj[r.key] = r.value));
      const s = mergeSettings(obj);
      setSettings(s);
      setLoaded(true);
      applyTheme(s.profile.theme);
      // تفريغ سلة المحذوفات القديمة
      const cutoff = new Date(Date.now() - s.data.trash_retention_days * 864e5).toISOString();
      for (const t of ["students", "subjects", "sessions", "assignments", "classes"]) {
        await supabase().from(t).delete().lt("deleted_at", cutoff);
      }
    })();
  }, []);

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

  return <SettingsCtx.Provider value={{ settings, loaded, save, reset }}>{children}</SettingsCtx.Provider>;
}
