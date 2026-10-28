// طبقة بين Supabase والشبكة: كل قراءة ناجحة تُحفظ على الجهاز، وعند انقطاع الإنترنت
// تُعاد آخر نسخة محفوظة. هكذا تفتح أي حصة أو مادة فُتحت سابقاً على هذا الجهاز بدون اتصال.
import { idbClear, idbEntries, idbDel, idbGet, idbSet } from "./idb";

type Cached = { status: number; headers: Record<string, string>; body: string; at: number };

// ---------- حالة الاتصال ----------
let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<(online: boolean) => void>();
export function isOnline() { return online; }
export function onConnectivity(fn: (online: boolean) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function setOnline(v: boolean) {
  if (v === online) return;
  online = v;
  listeners.forEach((f) => f(v));
}
if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}

const KEEP = ["content-type", "content-range", "preference-applied"];
const MAX_AGE = 45 * 864e5; // تُحذف النسخ الأقدم من 45 يوماً
let pruned = false;

function header(init: RequestInit | undefined, req: Request | null, name: string): string {
  const h = new Headers(init?.headers ?? req?.headers ?? undefined);
  return h.get(name) ?? "";
}

/** هل الطلب قراءة من قاعدة البيانات (وليس تسجيل دخول أو كتابة)؟ */
function cacheable(url: string, method: string) {
  return (method === "GET" || method === "HEAD") && url.includes("/rest/v1/");
}

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = input instanceof Request ? input : null;
  const url = req ? req.url : String(input);
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  if (!cacheable(url, method)) {
    try {
      const res = await fetch(input, init);
      setOnline(true);
      return res;
    } catch (e) {
      setOnline(false);
      throw e;
    }
  }
  const key = [method, url, header(init, req, "accept"), header(init, req, "prefer"), header(init, req, "range")].join(" ");

  const fromCache = async (): Promise<Response | null> => {
    const c = await idbGet<Cached>("http", key);
    if (!c) return null;
    return new Response(method === "HEAD" ? null : c.body, { status: c.status, headers: { ...c.headers, "x-offline-cache": String(c.at) } });
  };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setOnline(false);
    const c = await fromCache();
    if (c) return c;
  }
  try {
    const res = await fetch(input, init);
    setOnline(true);
    if (res.ok) {
      const copy = res.clone();
      copy.text().then((body) => {
        const headers: Record<string, string> = {};
        for (const k of KEEP) { const v = res.headers.get(k); if (v) headers[k] = v; }
        idbSet("http", key, { status: res.status, headers, body, at: Date.now() } satisfies Cached);
      }).catch(() => {});
      if (!pruned) { pruned = true; setTimeout(prune, 15_000); }
    }
    return res;
  } catch (e) {
    setOnline(false);
    const c = await fromCache();
    if (c) return c;
    throw e;
  }
}

async function prune() {
  const all = await idbEntries<Cached>("http");
  const now = Date.now();
  for (const [k, v] of all) if (!v || now - v.at > MAX_AGE) await idbDel("http", k);
}

/** يُستدعى عند تسجيل الخروج: لا تبقى بيانات الطلاب على الجهاز. */
export function clearOfflineCache() {
  return idbClear("http");
}
