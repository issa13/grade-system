"use client";
import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/paths";
import { Button } from "./ui";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "installBannerDismissed";

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/**
 * تسجيل الـ Service Worker، رسالة «تحديث جديد»، وبانر «أضف إلى الشاشة الرئيسية».
 */
export function PwaBanners() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [bip, setBip] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let reg: ServiceWorkerRegistration | undefined;
    const watch = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const w = r.installing;
        w?.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) setWaiting(w);
        });
      });
    };
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).then((r) => { reg = r; watch(r); r.update().catch(() => {}); }).catch(() => {});
    // بعد نشر نسخة جديدة: نتحقق عند فتح التطبيق وكل دقيقة
    const check = () => reg?.update().catch(() => {});
    const iv = setInterval(check, 60_000);
    const vis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", vis);
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, []);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === "1"); } catch { setDismissed(false); }
    if (isStandalone()) return;
    const h = (e: Event) => { e.preventDefault(); setBip(e as BIP); };
    window.addEventListener("beforeinstallprompt", h);
    if (isIos()) setIos(true);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  function dismiss() {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
  }

  return (
    <>
      {waiting && (
        <div className="no-print mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand-500 bg-brand-50 p-3 text-sm dark:bg-brand-700/20">
          <span className="flex-1 font-medium">تحديث جديد للموقع</span>
          <Button size="sm" onClick={() => waiting.postMessage("SKIP_WAITING")}>اضغط للتحميل</Button>
        </div>
      )}
      {!dismissed && (bip || ios) && (
        <div className="no-print mb-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-3">
            <img src={`${BASE_PATH}/icons/icon-192.png`} alt="" className="h-9 w-9 rounded-lg" />
            <span className="flex-1">أضف «العلامات» إلى الشاشة الرئيسية: يفتح كتطبيق ويعمل بدون إنترنت.</span>
            {bip ? (
              <Button size="sm" onClick={async () => { await bip.prompt(); const c = await bip.userChoice; if (c.outcome === "accepted") dismiss(); setBip(null); }}>تثبيت</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setShowIosHelp(!showIosHelp)}>كيف؟</Button>
            )}
            <button className="text-zinc-400 hover:text-zinc-700" onClick={dismiss} aria-label="إغلاق">✕</button>
          </div>
          {showIosHelp && <IosSteps />}
        </div>
      )}
    </>
  );
}

/** شرح بالصور للآيفون: مشاركة ← إضافة إلى الشاشة الرئيسية. */
function IosSteps() {
  const box = "flex flex-1 min-w-[140px] flex-col items-center gap-2 rounded-lg bg-zinc-50 p-3 text-center text-xs dark:bg-zinc-800/60";
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <div className={box}>
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="text-sky-600">
          <rect x="11" y="16" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M20 6v18M14 12l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span><b>1.</b> اضغط زر <b>المشاركة</b> في أسفل Safari</span>
      </div>
      <div className={box}>
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="text-zinc-700 dark:text-zinc-200">
          <rect x="8" y="8" width="24" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M20 14v12M14 20h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <span><b>2.</b> اختر <b>إضافة إلى الشاشة الرئيسية</b></span>
      </div>
      <div className={box}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">ع</span>
        <span><b>3.</b> اضغط <b>إضافة</b>. الأيقونة تظهر على الشاشة</span>
      </div>
    </div>
  );
}
