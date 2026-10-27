"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { absoluteUrl } from "@/lib/paths";
import { supabase } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase().auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const sb = supabase();
    if (mode === "login") {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setMsg({ text: "البريد أو كلمة المرور غير صحيحة", ok: false });
      else router.replace("/");
    } else if (mode === "signup") {
      const { error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: absoluteUrl("/") } });
      setMsg(error ? { text: error.message, ok: false } : { text: "تم إنشاء الحساب. افتح بريدك لتأكيده ثم سجّل الدخول.", ok: true });
    } else {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: absoluteUrl("/reset-password/") });
      setMsg(error ? { text: error.message, ok: false } : { text: "أرسلنا رابط تغيير كلمة المرور إلى بريدك.", ok: true });
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500 text-xl font-bold text-white">ع</div>
          <h1 className="text-xl font-bold">نظام إدارة العلامات</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {mode === "login" ? "تسجيل دخول الأستاذ" : mode === "signup" ? "إنشاء حساب الأستاذ" : "نسيت كلمة المرور"}
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="البريد الإلكتروني">
            <Input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          {mode !== "forgot" && (
            <Field label="كلمة المرور">
              <Input type="password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </Field>
          )}
          {msg && <p className={msg.ok ? "text-sm text-green-700" : "text-sm text-red-600"}>{msg.text}</p>}
          <Button className="w-full" disabled={busy}>
            {mode === "login" ? "دخول" : mode === "signup" ? "إنشاء الحساب" : "إرسال الرابط"}
          </Button>
        </form>
        <div className="mt-4 flex justify-between text-sm">
          {mode !== "login" ? (
            <button className="text-brand-600 hover:underline" onClick={() => setMode("login")}>الرجوع لتسجيل الدخول</button>
          ) : (
            <>
              <button className="text-brand-600 hover:underline" onClick={() => setMode("forgot")}>نسيت كلمة المرور؟</button>
              <button className="text-zinc-500 hover:underline" onClick={() => setMode("signup")}>حساب جديد</button>
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
