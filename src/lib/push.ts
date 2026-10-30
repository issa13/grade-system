"use client";
// إشعارات على التلفون (Web Push). الموقع يسجّل الجهاز فقط؛ الإرسال من مهمة GitHub Actions كل ساعة.
import { supabase } from "./supabase/client";

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushSupport = "ok" | "no-key" | "unsupported" | "ios-install" | "dev";

const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  if (!VAPID_PUBLIC_KEY) return "no-key";
  if (process.env.NODE_ENV !== "production") return "dev";
  // على الآيفون: الإشعارات تعمل فقط من التطبيق المضاف إلى الشاشة الرئيسية (iOS 16.4+)
  if (isIos() && !standalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : isIos() ? "iPhone/iPad" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "جهاز";
  const br = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung" : /Firefox/.test(ua) ? "Firefox" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ");
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("لم يجهز تطبيق الموقع بعد. أعد تحميل الصفحة وحاول مجدداً.")), 8000)),
  ]);
  return reg;
}

/** هل هذا الجهاز مسجّل للإشعارات؟ */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

/** تفعيل الإشعارات على هذا الجهاز (يجب أن يكون بعد ضغطة من الأستاذ). */
export async function enablePush(): Promise<void> {
  const sup = pushSupport();
  if (sup !== "ok") throw new Error(sup);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "dismissed");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  const j = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.keys?.p256dh || !j.keys?.auth) throw new Error("اشتراك غير مكتمل");
  const { data: u } = await supabase().auth.getUser();
  if (!u.user) throw new Error("not authorized");
  const { error } = await supabase().from("push_subscriptions").upsert(
    { owner_id: u.user.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, device: deviceLabel(), failures: 0 },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(error.message);
}

/** إيقاف الإشعارات على هذا الجهاز. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* لا شيء */ }
  const { error } = await supabase().from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(error.message);
}

/** إشعار تجربة من الجهاز نفسه (يتأكد أن الإذن والعرض يعملان). */
export async function localTest(): Promise<void> {
  const reg = await registration();
  await reg.showNotification("تجربة ✓", {
    body: "الإشعارات تعمل على هذا الجهاز. التنبيهات تُرسل كل ساعة من GitHub.",
    icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/icon-192.png`,
    badge: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/badge-72.png`,
    lang: "ar", dir: "rtl", tag: "test",
  });
}
