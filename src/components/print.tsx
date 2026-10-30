"use client";
import { fmtDate, today } from "@/lib/dates";
import { useSettings } from "./settings-provider";
import { Button } from "./ui";

/**
 * «تحميل PDF»: يطبع نفس الصفحة التي يراها الأستاذ (نفس الأرقام والرسوم والإعدادات).
 * في نافذة الطباعة: اختر «حفظ بصيغة PDF». اسم الملف = عنوان الصفحة + التاريخ.
 */
export function printPage(title: string) {
  const prevTitle = document.title;
  const html = document.documentElement;
  const wasDark = html.classList.contains("dark");
  document.title = `${title} - ${today()}`.replace(/[\\/:*?"<>|]/g, "-");
  if (wasDark) html.classList.remove("dark"); // الطباعة دائماً بخلفية بيضاء
  const restore = () => {
    document.title = prevTitle;
    if (wasDark) html.classList.add("dark");
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  // ننتظر لحظة حتى تُرسم الصفحة بالألوان الفاتحة
  setTimeout(() => {
    try { window.print(); } finally { setTimeout(restore, 500); }
  }, 60);
}

export function PrintButton({ title, label = "تحميل PDF", size = "md" }: { title: string; label?: string; size?: "sm" | "md" }) {
  return (
    <Button variant="secondary" size={size} className="no-print" onClick={() => printPage(title)} title="يفتح نافذة الطباعة: اختر «حفظ بصيغة PDF»">
      <span aria-hidden>⤓</span> {label}
    </Button>
  );
}

/** رأس يظهر في الـ PDF فقط: المدرسة، الأستاذ، العنوان والتاريخ. */
export function PrintHeader({ title, sub }: { title: string; sub?: string }) {
  const { settings } = useSettings();
  const logo = settings.report_images.logo || settings.profile.logo_url;
  return (
    <div className="mb-4 hidden items-center gap-3 border-b-2 border-zinc-800 pb-2 print:flex">
      {logo && <img src={logo} alt="" className="h-12 w-12 object-contain" />}
      <div className="flex-1">
        <div className="font-bold">{settings.profile.school_name}</div>
        <div className="text-xs text-zinc-600">{settings.profile.teacher_name}{settings.profile.teacher_name && " · "}السنة الدراسية {settings.year.school_year}</div>
      </div>
      <div className="text-left">
        <div className="font-bold">{title}</div>
        <div className="text-xs text-zinc-600">{sub}{sub && " · "}{fmtDate(today())}</div>
      </div>
    </div>
  );
}
