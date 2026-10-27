"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { Button, Card, Field, Input } from "@/components/ui";

export default function ResetPassword() {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase().auth.updateUser({ password: pw });
    if (error) setMsg(error.message);
    else router.replace("/");
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="mb-4 text-xl font-bold">كلمة مرور جديدة</h1>
        <form onSubmit={submit} className="space-y-4">
          <Field label="كلمة المرور الجديدة">
            <Input type="password" dir="ltr" minLength={6} required value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          <Button className="w-full">حفظ</Button>
        </form>
      </Card>
    </main>
  );
}
