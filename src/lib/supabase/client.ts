"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { offlineFetch } from "../offline-fetch";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** هل تمّ ضبط عنوان Supabase والمفتاح أثناء البناء؟ */
export const supabaseConfigured = /^https?:\/\/.+/.test(URL_) && KEY.length > 20;

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    if (!supabaseConfigured) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY غير مضبوطين");
    }
    client = createClient(URL_, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      // القراءات تُحفظ على الجهاز وتُستعمل عند انقطاع الإنترنت
      global: { fetch: offlineFetch },
    });
  }
  return client;
}

/** هل توجد جلسة دخول محفوظة على هذا الجهاز (حتى لو انتهت صلاحيتها وكنا بدون إنترنت)؟ */
export function hasStoredSession(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (/^sb-.+-auth-token$/.test(k)) return true;
    }
  } catch {}
  return false;
}
