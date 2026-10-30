"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { ClassRow } from "@/lib/types";
import { Button, Card, Empty, Field, Input, LoadError, Modal, PageHeader, Spinner, useToast } from "@/components/ui";
import { friendly } from "@/lib/errors";
import { useSettings } from "@/components/settings-provider";

type Row = ClassRow & { students: { count: number }[]; subjects: { count: number }[] };

/** قائمة الصفوف (كانت الصفحة الرئيسية في الإصدار الأول). */
export function ClassesList() {
  const { settings } = useSettings();
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [edit, setEdit] = useState<Partial<ClassRow> | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase()
      .from("classes")
      .select("*, students(count), subjects(count)")
      .is("deleted_at", null)
      .is("students.deleted_at", null)
      .is("subjects.deleted_at", null)
      .order("created_at");
    if (error) { toast({ text: friendly(error), kind: "err" }); setErr(true); return; }
    setErr(false);
    setRows((data as Row[]) ?? []);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    const name = (edit?.name ?? "").replace(/\s+/g, " ").trim();
    if (!name) return toast({ text: "اسم الصف مطلوب", kind: "err" });
    if (name.length > 200) return toast({ text: "اسم الصف طويل جداً", kind: "err" });
    const payload = { name, school_year: edit.school_year || settings.year.school_year, notes: edit.notes ?? null };
    const q = edit.id ? supabase().from("classes").update(payload).eq("id", edit.id) : supabase().from("classes").insert(payload);
    const { error } = await q;
    if (error) return toast({ text: error.message, kind: "err" });
    toast({ text: "تم الحفظ", kind: "ok" });
    setEdit(null);
    load();
  }

  async function setArchived(c: Row, archived: boolean) {
    { const { error: wErr } = await supabase().from("classes").update({ archived }).eq("id", c.id); if (wErr) return toast({ text: friendly(wErr), kind: "err" }); }
    load();
  }
  async function remove(c: Row) {
    { const { error: wErr } = await supabase().from("classes").update({ deleted_at: new Date().toISOString() }).eq("id", c.id); if (wErr) return toast({ text: friendly(wErr), kind: "err" }); }
    toast({
      text: `تم نقل "${c.name}" إلى سلة المحذوفات`, kind: "ok",
      action: { label: "تراجع", run: async () => { await supabase().from("classes").update({ deleted_at: null }).eq("id", c.id); load(); } },
    });
    load();
  }

  const visible = (rows ?? []).filter((r) => r.archived === showArchived);

  return (
    <div>
      <PageHeader
        info="كل صف له طلاب ومواد. «أرشفة» تخفي الصف دون حذفه (مثلاً صفوف السنة الماضية). «حذف» ينقله إلى سلة المحذوفات."
        title="الصفوف"
        sub={`السنة الدراسية ${settings.year.school_year}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "الصفوف الحالية" : "المؤرشفة"}</Button>
            <Button onClick={() => setEdit({ school_year: settings.year.school_year })}>+ صف جديد</Button>
          </>
        }
      />
      {err && !rows ? <LoadError onRetry={load} /> : !rows ? <Spinner /> : visible.length === 0 ? (
        <Empty>{showArchived ? "لا توجد صفوف مؤرشفة." : "لا توجد صفوف بعد. ابدأ بإضافة صف."}</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((c) => (
            <Card key={c.id} className="flex flex-col">
              <Link href={`/class?id=${c.id}`} className="group flex-1">
                <div className="text-lg font-semibold group-hover:text-brand-600">{c.name}</div>
                <div className="text-sm text-zinc-500">{c.school_year}</div>
                <div className="mt-3 flex gap-4 text-sm">
                  <span><b>{c.students?.[0]?.count ?? 0}</b> طالب</span>
                  <span><b>{c.subjects?.[0]?.count ?? 0}</b> مادة</span>
                </div>
                {c.notes && <p className="mt-2 line-clamp-2 text-sm text-zinc-500">{c.notes}</p>}
              </Link>
              <div className="mt-4 flex gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>تعديل</Button>
                <Button size="sm" variant="ghost" onClick={() => setArchived(c, !c.archived)}>{c.archived ? "إلغاء الأرشفة" : "أرشفة"}</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(c)}>حذف</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "تعديل الصف" : "صف جديد"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="اسم الصف"><Input autoFocus required value={edit?.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="مثال: BT3 - كهرباء صناعية" /></Field>
          <Field label="السنة الدراسية"><Input value={edit?.school_year ?? ""} onChange={(e) => setEdit({ ...edit, school_year: e.target.value })} /></Field>
          <Field label="ملاحظات"><Input value={edit?.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button>
            <Button>حفظ</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
