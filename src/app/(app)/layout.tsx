"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SettingsProvider, useSettings } from "@/components/settings-provider";
import { hasStoredSession, supabase } from "@/lib/supabase/client";
import { getState, startOutbox } from "@/lib/outbox";
import { clearOfflineCache } from "@/lib/offline-fetch";
import { cx, confirmAction } from "@/components/ui";
import { Relogin, SyncIndicator } from "@/components/sync-status";
import { AlertsProvider, Bell } from "@/components/alerts";
import { PwaBanners } from "@/components/pwa";
import { SchemaCheck } from "@/components/schema-check";
import { QuickSearch } from "@/components/quick-search";
import { logError, friendly } from "@/lib/errors";
import { ErrorBoundary, useToast } from "@/components/ui";

const NAV = [
  { href: "/schedule", label: "البرنامج", icon: "▥" },
  { href: "/classes", label: "الصفوف", icon: "▦" },
  { href: "/stats", label: "إحصائياتي", icon: "▤" },
  { href: "/settings", label: "الإعدادات", icon: "⚙" },
  { href: "/trash", label: "سلة المحذوفات", icon: "🗑" },
  { href: "/audit", label: "سجل التعديلات", icon: "↺" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);

  const toast = useToast();
  useEffect(() => { startOutbox(); }, []);
  // أي خطأ غير متوقع: يُسجَّل في «سجل الأخطاء» ويظهر للأستاذ برسالة واضحة (مرة كل 5 ثوانٍ كحد أقصى)
  useEffect(() => {
    let last = 0;
    const show = (e: unknown) => {
      logError(e);
      if (Date.now() - last < 5000) return;
      last = Date.now();
      toast({ text: friendly(e), kind: "err" });
    };
    const onErr = (e: ErrorEvent) => show(e.error ?? e.message);
    const onRej = (e: PromiseRejectionEvent) => show(e.reason);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => { window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); };
  }, [toast]);

  async function logout() {
    const n = getState().pending;
    if (n && !confirmAction(`توجد ${n} تغييرات لم تُرسل بعد (بدون إنترنت). إذا خرجت الآن تبقى محفوظة على هذا الجهاز وتُرسل بعد تسجيل الدخول مجدداً. خروج؟`)) return;
    await clearOfflineCache();
    await supabase().auth.signOut();
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n0) => {
        // البرنامج هو الصفحة الرئيسية إلا إذا اختار الأستاذ قائمة الصفوف
        const n = n0.href === "/schedule" && settings.schedule.home === "schedule" ? { ...n0, href: "/" } : n0.href === "/classes" && settings.schedule.home === "classes" ? { ...n0, href: "/" } : n0;
        const isSchedule = n0.href === "/schedule";
        const active = isSchedule ? path === "/schedule" || path.startsWith("/session") || (path === "/" && settings.schedule.home === "schedule")
          : n0.href === "/classes" ? path.startsWith("/class") || path.startsWith("/subject") || path.startsWith("/student") || path.startsWith("/report") || (path === "/" && settings.schedule.home === "classes")
          : path.startsWith(n.href);
        return (
          <Link key={n0.href} href={n.href} onClick={() => setOpen(false)}
            className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
              active ? "bg-brand-500 text-white" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")}>
            <span className="w-5 text-center" aria-hidden>{n.icon}</span>{n.label}
          </Link>
        );
      })}
      <button onClick={logout} className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
        <span className="w-5 text-center" aria-hidden>⎋</span>تسجيل الخروج
      </button>
    </nav>
  );

  const brand = (
    <div className="mb-6 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-lg font-bold text-white">ع</div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-bold">{settings.profile.school_name || "نظام العلامات"}</div>
        <div className="truncate text-xs text-zinc-500">{settings.profile.teacher_name || "الأستاذ"}</div>
      </div>
      <button onClick={() => window.dispatchEvent(new Event("open-search"))} className="no-print inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="بحث عن طالب (Ctrl+K)" title="بحث عن طالب (Ctrl+K)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
      <Bell />
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print hidden w-64 shrink-0 border-l border-zinc-200 bg-white p-4 lg:block dark:border-zinc-800 dark:bg-zinc-900">
        <div className="sticky top-4">{brand}<div className="mb-4 -mt-2"><SyncIndicator /></div>{nav}</div>
      </aside>
      <header className="no-print sticky top-0 z-40 flex items-center gap-2 border-b border-zinc-200 bg-white/95 px-4 py-2 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/95">
        <span className="min-w-0 flex-1 truncate font-bold">{settings.profile.school_name || "نظام العلامات"}</span>
        <SyncIndicator />
        <button onClick={() => window.dispatchEvent(new Event("open-search"))} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="بحث عن طالب"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
        <Bell />
        <button onClick={() => setOpen(!open)} className="rounded-lg border px-3 py-1 text-sm dark:border-zinc-700" aria-expanded={open}>القائمة</button>
      </header>
      {open && <div className="no-print border-b border-zinc-200 bg-white p-4 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">{nav}</div>}
      <main className="min-w-0 flex-1 p-4 print:p-0 lg:p-8">
        <SchemaCheck />
        <PwaBanners />
        <Relogin />
        <QuickSearch />
        <ErrorBoundary key={path}>{children}</ErrorBoundary>
      </main>
    </div>
  );
}

/** يمنع الدخول إلى صفحات الأستاذ بدون تسجيل دخول (الحماية الفعلية للبيانات عبر RLS في قاعدة البيانات). */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data, error }) => {
      if (data.session) setOk(true);
      // بدون إنترنت: نسمح بالدخول بالجلسة المحفوظة (البيانات من النسخة المحفوظة على الجهاز)
      else if (hasStoredSession() && (!navigator.onLine || error?.name === "AuthRetryableFetchError")) setOk(true);
      else router.replace("/login");
    }).catch(() => { if (hasStoredSession()) setOk(true); else router.replace("/login"); });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || (!session && navigator.onLine && !hasStoredSession())) router.replace("/login");
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);
  if (!ok) return <div className="flex min-h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" /></div>;
  return <>{children}</>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SettingsProvider>
        <AlertsProvider>
          <Shell>{children}</Shell>
        </AlertsProvider>
      </SettingsProvider>
    </AuthGuard>
  );
}
