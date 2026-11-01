"use client";
// إشعارات تطبيق أندرويد — بنفس طريقة تطبيق «إتقان»: كل شيء على التلفون نفسه، بدون خادم.
//
// Web Push (الإشعارات من GitHub كل ساعة) لا يعمل داخل التطبيق، لذلك:
//  • عند فتح التطبيق أو الرجوع إليه تُحسب التنبيهات بنفس محرك الموقع (computeAlerts)،
//    لليوم ولـ 7 أيام قادمة (بافتراض أنك لن تسجّل شيئاً جديداً).
//  • ما هو جديد اليوم يظهر كإشعار فوراً، وما سيصبح تنبيهاً في يوم قادم (حصة لم تُسجّل،
//    امتحان مرّت عليه أيام بلا علامات، «ذكّرني بعد أسبوع» انتهى…) يُجدول صباح ذلك اليوم،
//    فيصل حتى لو كان التطبيق مسكّراً.
//  • كل مرة تفتح التطبيق يُعاد الحساب: إذا سجّلت الحصة أو أدخلت العلامات يُلغى إشعارها.
//  • نفس إعدادات «الإشعارات» في الموقع: أنواع التنبيهات، ساعات الهدوء، العطلة الأسبوعية،
//    والحد الأقصى في كل مرة.
// على الموقع (المتصفح) هذا الملف لا يفعل شيئاً.

import { computeAlerts, groupAlerts, visibleAlerts, type AlertData, type AlertItem } from "./alerts";
import { addDays } from "./schedule";
import { today } from "./dates";
import type { Settings } from "./settings";
import type { AlertState } from "./types";

type Perm = "granted" | "denied" | "prompt" | "prompt-with-rationale";
type LocalNotification = {
  id: number; title: string; body: string; largeBody?: string; channelId?: string; smallIcon?: string; iconColor?: string;
  autoCancel?: boolean; schedule?: { at: Date; allowWhileIdle?: boolean }; extra?: Record<string, unknown>;
};
export type LNPlugin = {
  checkPermissions(): Promise<{ display: Perm }>;
  requestPermissions(): Promise<{ display: Perm }>;
  createChannel?(c: { id: string; name: string; description?: string; importance?: number; visibility?: number; vibration?: boolean }): Promise<void>;
  schedule(o: { notifications: LocalNotification[] }): Promise<unknown>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  // داخل التطبيق يرجع { remove } مباشرة (وليس Promise) — يجب قبول الاثنين
  addListener(ev: "localNotificationActionPerformed", fn: (e: { notification: { extra?: Record<string, unknown> } }) => void): { remove: () => unknown } | Promise<{ remove: () => unknown }>;
};
type Cap = { isNativePlatform?: () => boolean; Plugins?: { LocalNotifications?: LNPlugin } };

const capacitor = (): Cap | undefined => (typeof window === "undefined" ? undefined : (window as unknown as { Capacitor?: Cap }).Capacitor);

/** هل الصفحة تعمل داخل تطبيق أندرويد (وليس في المتصفح)؟ */
export const isNativeApp = (): boolean => !!capacitor()?.isNativePlatform?.();

/** إضافة الإشعارات في التطبيق (null على الموقع). */
export const nativeLN = (): LNPlugin | null => (isNativeApp() ? capacitor()?.Plugins?.LocalNotifications ?? null : null);

const ENABLED_KEY = "gs_app_notify"; // "1" = فعّلها الأستاذ على هذا التلفون
const MEMORY_KEY = "gs_app_notify_memory";
const CHANNEL = "alerts";
const ICON = "ic_stat_grades";
const ICON_COLOR = "#1F7A68";
const DAYS = 7; // كم يوماً للأمام تُجدول الإشعارات
const MAX_PER_DAY = 10;
const ID_BASE = 710000; // معرّفات إشعاراتنا: ID_BASE + يوم*MAX_PER_DAY + رقم
const ID_TEST = ID_BASE - 1;
export const NOTIFY_CHANGED = "gs:app-notify-changed";

export function appNotifyEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch { return false; }
}

export async function appNotifyPermission(): Promise<Perm | "unsupported"> {
  const ln = nativeLN();
  if (!ln) return "unsupported";
  try { return (await ln.checkPermissions()).display; } catch { return "denied"; }
}

/** تفعيل/إيقاف الإشعارات على هذا التلفون. يطلب الإذن عند التفعيل. */
export async function setAppNotify(on: boolean): Promise<Perm | "unsupported"> {
  const ln = nativeLN();
  if (!ln) return "unsupported";
  let perm = await appNotifyPermission();
  if (on && perm !== "granted") {
    try { perm = (await ln.requestPermissions()).display; } catch { perm = "denied"; }
  }
  if (on && perm === "granted") {
    try {
      await ln.createChannel?.({ id: CHANNEL, name: "التنبيهات", description: "غياب متتالٍ، حصص لم تُسجّل، علامات ناقصة…", importance: 4, visibility: 1, vibration: true });
    } catch { /* أندرويد قديم */ }
  }
  try { localStorage.setItem(ENABLED_KEY, on && perm === "granted" ? "1" : "0"); } catch { /* لا شيء */ }
  window.dispatchEvent(new Event(NOTIFY_CHANGED));
  return perm;
}

export async function appNotifyTest(): Promise<void> {
  const ln = nativeLN();
  if (!ln) throw new Error("unsupported");
  await ln.schedule({ notifications: [{
    id: ID_TEST, title: "تجربة ✓", body: "الإشعارات تعمل على هذا التلفون.",
    channelId: CHANNEL, smallIcon: ICON, iconColor: ICON_COLOR, autoCancel: true,
    schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
  }] });
}

// ---------------- الذاكرة: ما أُرسل وما هو مجدول ----------------
type Memory = { sent: Record<string, string>; planned: Record<string, { fp: string; at: number }> };
function loadMemory(): Memory {
  try {
    const m = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "null");
    if (m && typeof m === "object") return { sent: m.sent ?? {}, planned: m.planned ?? {} };
  } catch { /* لا شيء */ }
  return { sent: {}, planned: {} };
}
function saveMemory(m: Memory) {
  try { localStorage.setItem(MEMORY_KEY, JSON.stringify(m)); } catch { /* لا شيء */ }
}

// ---------------- الوقت: ساعات الهدوء والعطلة ----------------
const toMin = (t: unknown) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const MORNING = 7 * 60; // إشعارات الأيام القادمة: من الساعة 7 صباحاً (أو نهاية ساعات الهدوء)

/** أول دقيقة مسموحة في هذا اليوم ابتداءً من «from»، أو null (عطلة / ما بقي وقت). */
function firstAllowedMinute(iso: string, from: number, s: Settings): number | null {
  const P = s.push;
  const weekday = new Date(`${iso}T12:00:00`).getDay();
  if (P.weekend_off && s.year.weekend_days.includes(weekday)) return null;
  const a = toMin(P.quiet_from), b = toMin(P.quiet_to);
  if (a === null || b === null || a === b) return from;
  const quiet = (m: number) => (a < b ? m >= a && m < b : m >= a || m < b);
  if (!quiet(from)) return from;
  return b > from && !quiet(b) ? b : null;
}

function at(iso: string, minute: number): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setMinutes(minute);
  return d;
}

/** نفس نص إشعارات GitHub (scripts/push.mjs). */
function bodyOf(items: AlertItem[]) {
  return items.slice(0, 3).map((i) => `• ${i.label}${i.detail && i.rule !== "unlogged" ? ` (${i.detail})` : ""}`).join("\n")
    + (items.length > 3 ? `\n… و${items.length - 3} أخرى` : "");
}

let running: Promise<void> = Promise.resolve();

/** يلغي إشعاراتنا المجدولة ويجدولها من جديد من البيانات الحالية. آمن للاستدعاء كثيراً. */
export function replanAppNotifications(data: AlertData | null, states: AlertState[], s: Settings): Promise<void> {
  const job = () => plan(data, states, s).catch((e) => console.warn("app notifications", e));
  running = running.then(job, job);
  return running;
}

async function plan(data: AlertData | null, states: AlertState[], s: Settings) {
  const ln = nativeLN();
  if (!ln) return;
  const ids: { id: number }[] = [];
  for (let i = 0; i < DAYS * MAX_PER_DAY; i++) ids.push({ id: ID_BASE + i });
  try { await ln.cancel({ notifications: ids }); } catch { /* لا شيء مجدول */ }

  const mem = loadMemory();
  const now = new Date();
  // ما كان مجدولاً ووقته مضى = وصل
  for (const [k, v] of Object.entries(mem.planned)) if (v.at <= now.getTime()) mem.sent[k] = v.fp;
  mem.planned = {};

  if (!data || !appNotifyEnabled() || (await appNotifyPermission()) !== "granted") { saveMemory(mem); return; }

  const rules = new Set<string>(s.push.rules ?? []);
  const t = today();
  const alertsOn = (iso: string) => visibleAlerts(computeAlerts(data, s, iso), states, iso).filter((i) => rules.has(i.rule));

  const current = alertsOn(t);
  // تنبيه حُلّ (لم يعد موجوداً) يُنسى، فإذا عاد لاحقاً يصل إشعاره من جديد (مثل push.mjs)
  const live = new Set(current.map((i) => i.key));
  for (const k of Object.keys(mem.sent)) if (!live.has(k)) delete mem.sent[k];

  const list: LocalNotification[] = [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let d = 0; d < DAYS; d++) {
    const iso = addDays(t, d);
    const minute = d === 0 ? firstAllowedMinute(iso, nowMin, s) : firstAllowedMinute(iso, MORNING, s);
    if (minute === null) continue; // عطلة أو ساعات هدوء حتى آخر اليوم: تنتقل لليوم التالي
    const when = d === 0 && minute === nowMin ? new Date(now.getTime() + 2000) : at(iso, minute);
    const items = (d === 0 ? current : alertsOn(iso)).filter((i) => mem.sent[i.key] !== i.fingerprint && mem.planned[i.key]?.fp !== i.fingerprint);
    if (!items.length) continue;
    const groups = groupAlerts(items, s).slice(0, Math.min(MAX_PER_DAY, Math.max(1, s.push.max_per_run)));
    groups.forEach((g, n) => {
      const one = g.items.length === 1 ? g.items[0] : null;
      list.push({
        id: ID_BASE + d * MAX_PER_DAY + n,
        title: g.title,
        body: bodyOf(g.items),
        largeBody: bodyOf(g.items),
        channelId: CHANNEL, smallIcon: ICON, iconColor: ICON_COLOR, autoCancel: true,
        schedule: { at: when, allowWhileIdle: true },
        extra: one ? { href: one.href, create: one.create ?? null } : { alerts: 1 },
      });
      for (const i of g.items) mem.planned[i.key] = { fp: i.fingerprint, at: when.getTime() };
    });
  }
  saveMemory(mem);
  if (list.length) await ln.schedule({ notifications: list });
}
