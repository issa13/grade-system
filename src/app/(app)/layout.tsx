"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SettingsProvider, useSettings } from "@/components/settings-provider";
import { supabase } from "@/lib/supabase/client";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/", label: "الصفوف", icon: "▦" },
  { href: "/stats", label: "إحصائياتي", icon: "▤" },
  { href: "/settings", label: "الإعدادات", icon: "⚙" },
  { href: "/trash", label: "سلة المحذوفات", icon: "🗑" },
  { href: "/audit", label: "سجل التعديلات", icon: "↺" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);

  async function logout() {
    await supabase().auth.signOut();
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.map((n) => {
        const active = n.href === "/" ? path === "/" || path.startsWith("/class") || path.startsWith("/subject") || path.startsWith("/session") || path.startsWith("/student") : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
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
      <div className="min-w-0">
        <div className="truncate font-bold">{settings.profile.school_name || "نظام العلامات"}</div>
        <div className="truncate text-xs text-zinc-500">{settings.profile.teacher_name || "الأستاذ"}</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print hidden w-60 shrink-0 border-l border-zinc-200 bg-white p-4 lg:block dark:border-zinc-800 dark:bg-zinc-900">
        <div className="sticky top-4">{brand}{nav}</div>
      </aside>
      <header className="no-print flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <span className="font-bold">{settings.profile.school_name || "نظام العلامات"}</span>
        <button onClick={() => setOpen(!open)} className="rounded-lg border px-3 py-1 text-sm dark:border-zinc-700" aria-expanded={open}>القائمة</button>
      </header>
      {open && <div className="no-print border-b border-zinc-200 bg-white p-4 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">{nav}</div>}
      <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
    </div>
  );
}

/** يمنع الدخول إلى صفحات الأستاذ بدون تسجيل دخول (الحماية الفعلية للبيانات عبر RLS في قاعدة البيانات). */
function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setOk(true);
      else router.replace("/login");
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) router.replace("/login");
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
        <Shell>{children}</Shell>
      </SettingsProvider>
    </AuthGuard>
  );
}
