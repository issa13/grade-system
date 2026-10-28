/* Service worker — نظام العلامات
 * يحفظ ملفات الموقع على الجهاز فيفتح فوراً حتى بدون شبكة.
 * البيانات نفسها (Supabase) يحفظها التطبيق في IndexedDB، وليس هنا.
 * صفحة الطالب (s/) لا تُحفظ أبداً: يجب أن تعرض دائماً أحدث العلامات.
 * VERSION يُستبدل تلقائياً عند كل بناء (scripts/sw-version.mjs) حتى تظهر رسالة «تحديث جديد».
 */
const VERSION = "__BUILD_ID__";
const CACHE = "gs-" + VERSION;
const SCOPE = new URL(self.registration.scope).pathname; // مثلاً /grade-system/
const ROUTES = ["", "schedule/", "classes/", "session/", "subject/", "class/", "student/", "stats/", "settings/", "login/", "trash/", "audit/", "report/"];
const EXTRA = ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

const keyOf = (url) => { const u = new URL(url); return u.origin + u.pathname; };
const isStudentPage = (u) => u.pathname.startsWith(SCOPE + "s/");

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const assets = new Set(EXTRA.map((p) => SCOPE + p));
    for (const r of ROUTES) {
      try {
        const res = await fetch(SCOPE + r, { cache: "no-store" });
        if (!res.ok) continue;
        const html = await res.clone().text();
        await cache.put(keyOf(new URL(SCOPE + r, self.location.origin).href), res);
        for (const m of html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
      } catch (e) { /* بدون شبكة أثناء التثبيت */ }
    }
    await Promise.all([...assets].map((a) => cache.add(a).catch(() => {})));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("gs-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // الخطوط من Google: تُحفظ بعد أول تحميل
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (isStudentPage(url)) return; // صفحة الطالب: من الشبكة دائماً

  // صفحات الموقع: من الشبكة أولاً، وبدون شبكة آخر نسخة محفوظة
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await networkFirst(req, keyOf(req.url));
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match(keyOf(req.url))) || (await cache.match(keyOf(new URL(SCOPE, self.location.origin).href))) || Response.error();
      }
    })());
    return;
  }
  // ملفات Next الثابتة (أسماؤها تتغير مع كل نسخة): من الجهاز أولاً
  if (url.pathname.includes("/_next/static/")) {
    event.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // بيانات التنقل بين الصفحات (.txt) وباقي الملفات
  event.respondWith(networkFirst(req, keyOf(req.url)));
});
