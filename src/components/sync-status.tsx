"use client";
import { useState, useSyncExternalStore } from "react";
import { supabase } from "@/lib/supabase/client";
import { getState, resolveRejected, resumeAfterLogin, subscribe, type Rejected } from "@/lib/outbox";
import { Button, Field, Input, Modal, cx, useToast } from "./ui";

export function useSync() {
  return useSyncExternalStore(subscribe, getState, getState);
}

const TABLE_NAMES: Record<string, string> = {
  session_records: "تسجيل حصة", grade_entries: "علامة", assignment_submissions: "واجب", sessions: "حصة",
};

/** المؤشر الثابت في أعلى الشاشة: محفوظ / بدون إنترنت / خطأ. */
export function SyncIndicator({ className }: { className?: string }) {
  const s = useSync();
  const [open, setOpen] = useState(false);
  const label =
    s.status === "auth" ? `انتهى تسجيل الدخول — ${s.pending} بانتظار الإرسال`
    : s.status === "offline" ? (s.pending ? `بدون إنترنت — ${s.pending} ${s.pending === 1 ? "تغيير" : "تغييرات"} بانتظار الإرسال` : "بدون إنترنت")
    : s.status === "syncing" ? (s.pending ? `جارٍ الإرسال… (${s.pending})` : "جارٍ الإرسال…")
    : s.status === "error" ? "خطأ — اضغط للتفاصيل"
    : "✓ محفوظ";
  const tone =
    s.status === "saved" ? "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/50 dark:text-green-300"
    : s.status === "syncing" ? "border-zinc-200 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
    : s.status === "offline" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
    : "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300";
  return (
    <>
      <button onClick={() => setOpen(true)} aria-live="polite"
        className={cx("no-print inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", tone, className)}>
        {s.status === "offline" && <span aria-hidden>⚡</span>}
        {s.status === "error" || s.status === "auth" ? <span aria-hidden>!</span> : null}
        {label}
      </button>
      <SyncDetails open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SyncDetails({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSync();
  return (
    <Modal open={open} onClose={onClose} title="حالة الحفظ" wide>
      <div className="space-y-4 text-sm">
        <p className="leading-7 text-zinc-600 dark:text-zinc-300">
          كل تسجيل حصة أو علامة يُحفظ أولاً على هذا الجهاز، ثم يُرسل وحده عند وجود إنترنت (عند عودة الاتصال، عند فتح التطبيق، وكل 30 ثانية).
          {" "}{s.online ? "الاتصال متوفر." : "لا يوجد اتصال الآن — يمكنك متابعة تسجيل الحصة وإدخال العلامات."}
        </p>
        <div className="flex flex-wrap gap-4">
          <span>بانتظار الإرسال: <b>{s.pending}</b></span>
          <span>تعديلات لم تُطبّق: <b>{s.rejected.length}</b></span>
          {s.lastSync && <span className="text-zinc-500">آخر إرسال: {new Date(s.lastSync).toLocaleTimeString("ar-LB")}</span>}
        </div>
        {s.rejected.length > 0 && (
          <div>
            <h3 className="mb-2 font-semibold">تعديلات لم تُطبّق</h3>
            <p className="mb-2 text-xs text-zinc-500">«أقدم من المحفوظ»: هذا التعديل سُجّل على هذا الجهاز قبل تعديل أحدث من جهاز آخر، لذلك بقي التعديل الأحدث. «طبّق على أي حال» يرسله الآن ويكتب فوق الأحدث.</p>
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {s.rejected.map((r) => <RejectedRow key={r.id} r={r} />)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function describe(r: Rejected): string {
  const x = r.row;
  if (r.table === "grade_entries") return `علامة ${String(x.component)}: ${x.excused ? "معفى" : x.score ?? "فارغ"}`;
  if (r.table === "session_records") {
    const parts = [x.absence ? "غياب" : "", x.late ? "تأخير" : "", Number(x.participation) ? `مشاركة ${x.participation}` : "", Number(x.disruption) ? `شغب ${x.disruption}` : "", x.homework ? `وظيفة: ${x.homework === "done" ? "منجزة" : "غير منجزة"}` : ""].filter(Boolean);
    return parts.join(" · ") || "حاضر";
  }
  if (r.table === "assignment_submissions") return `حالة الواجب: ${x.status ?? "فارغ"}`;
  return "";
}

function RejectedRow({ r }: { r: Rejected }) {
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{TABLE_NAMES[r.table] ?? r.table} — {describe(r)}</div>
        <div className="text-xs text-zinc-500">
          {r.reason === "stale" ? "أقدم من المحفوظ" : `خطأ: ${r.message ?? ""}`} · {new Date(r.at).toLocaleString("ar-LB")}
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={() => resolveRejected(r.id, "apply")}>طبّق على أي حال</Button>
      <Button size="sm" variant="ghost" onClick={() => resolveRejected(r.id, "discard")}>تجاهل</Button>
    </li>
  );
}

/** عند انتهاء تسجيل الدخول أثناء الإرسال: نطلب كلمة المرور ونحتفظ بالصادر. */
export function Relogin() {
  const s = useSync();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem("lastEmail") ?? ""; } catch { return ""; }
  });
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (s.status !== "auth" || dismissed) return null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase().auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) return toast({ text: "تعذّر تسجيل الدخول: " + error.message, kind: "err" });
    setPw("");
    resumeAfterLogin();
    toast({ text: "تمّ — جارٍ إرسال التغييرات", kind: "ok" });
  }
  return (
    <Modal open onClose={() => setDismissed(true)} title="سجّل الدخول لإرسال التغييرات">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">انتهت مدة تسجيل الدخول. لديك <b>{s.pending}</b> تغييرات محفوظة على هذا الجهاز وستُرسل بعد إدخال كلمة المرور. لن يضيع شيء.</p>
        <Field label="البريد الإلكتروني"><Input type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="كلمة المرور"><Input type="password" required autoFocus dir="ltr" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDismissed(true)}>لاحقاً</Button>
          <Button disabled={busy}>دخول وإرسال</Button>
        </div>
      </form>
    </Modal>
  );
}
