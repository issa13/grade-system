"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { enqueue, overlay } from "@/lib/outbox";
import { friendly } from "@/lib/errors";
import { fmtDate, semesterFor, today } from "@/lib/dates";
import { exportXlsx } from "@/lib/excel";
import type { Assignment, Student, Subject, Submission } from "@/lib/types";
import { useSettings } from "./settings-provider";
import { Info } from "./info";
import { Button, Card, Empty, Field, Input, Modal, Select, Spinner, cx, useToast } from "./ui";

const STATUS: { id: Submission["status"]; label: string; cls: string }[] = [
  { id: "done", label: "منجزة", cls: "bg-green-600 text-white" },
  { id: "late", label: "متأخرة", cls: "bg-amber-500 text-white" },
  { id: "missing", label: "غير منجزة", cls: "bg-red-600 text-white" },
];

export function AssignmentsTab({ subject, students }: { subject: Subject; students: Student[] }) {
  const { settings } = useSettings();
  const toast = useToast();
  const [list, setList] = useState<Assignment[] | null>(null);
  const [sel, setSel] = useState<Assignment | null>(null);
  const [subs, setSubs] = useState<Record<string, Submission>>({});
  const [edit, setEdit] = useState<Partial<Assignment> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase().from("assignments").select("*").eq("subject_id", subject.id).is("deleted_at", null).order("due_date", { ascending: false });
    if (error) { toast({ text: friendly(error), kind: "err" }); return; }
    setList((data ?? []) as Assignment[]);
  }, [subject.id, toast]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!sel) return;
    supabase().from("assignment_submissions").select("*").eq("assignment_id", sel.id).then(({ data, error }) => {
      if (error) { toast({ text: friendly(error), kind: "err" }); setSel(null); return; }
      const m: Record<string, Submission> = {};
      overlay("assignment_submissions", (data ?? []) as Submission[], (r) => r.assignment_id === sel.id).forEach((s) => (m[s.student_id] = s));
      setSubs(m);
    });
  }, [sel, toast]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit?.title) return;
    const due = edit.due_date || null;
    const p = { title: edit.title, due_date: due, max_score: edit.max_score ? Number(edit.max_score) : null, semester: edit.semester ?? (due ? semesterFor(due, settings) : 1) };
    const { error } = edit.id
      ? await supabase().from("assignments").update(p).eq("id", edit.id)
      : await supabase().from("assignments").insert({ ...p, subject_id: subject.id });
    if (error) return toast({ text: error.message, kind: "err" });
    setEdit(null);
    load();
  }

  async function setSub(st: Student, patch: Partial<Submission>) {
    if (!sel) return;
    const cur = subs[st.id] ?? { assignment_id: sel.id, student_id: st.id, status: null, score: null };
    const next = { ...cur, ...patch };
    setSubs((m) => ({ ...m, [st.id]: next }));
    enqueue("assignment_submissions", { assignment_id: sel.id, student_id: st.id, status: next.status, score: next.score });
  }

  async function markAll(status: Submission["status"]) {
    if (!sel) return;
    const rows = students.map((st) => ({ assignment_id: sel.id, student_id: st.id, status, score: subs[st.id]?.score ?? null }));
    setSubs(Object.fromEntries(rows.map((r) => [r.student_id, r])));
    rows.forEach((r) => enqueue("assignment_submissions", r));
  }

  async function remove(a: Assignment) {
    { const { error: wErr } = await supabase().from("assignments").update({ deleted_at: new Date().toISOString() }).eq("id", a.id); if (wErr) return toast({ text: friendly(wErr), kind: "err" }); }
    setSel(null);
    load();
  }

  async function exportAll() {
    if (!list?.length) return;
    const { data } = await supabase().from("assignment_submissions").select("*").in("assignment_id", list.map((a) => a.id));
    const all = (data ?? []) as Submission[];
    const label = (s?: Submission) => STATUS.find((x) => x.id === s?.status)?.label ?? "";
    await exportXlsx([{
      name: "الواجبات", title: `${subject.name} — الواجبات`,
      header: ["#", "الاسم", ...list.map((a) => a.title)],
      rows: students.map((st, i) => [i + 1, st.full_name, ...list.map((a) => {
        const s = all.find((x) => x.assignment_id === a.id && x.student_id === st.id);
        return s?.score != null ? `${label(s)} (${s.score})` : label(s);
      })]),
    }], `واجبات ${subject.name}.xlsx`);
  }

  if (!list) return <Spinner />;

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div>
        <div className="mb-2 flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => setEdit({ due_date: today() })}>+ واجب</Button>
          <Button size="sm" variant="secondary" onClick={exportAll}>تصدير</Button>
        </div>
        {list.length === 0 ? <Empty>لا توجد واجبات.</Empty> : (
          <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
            {list.map((a) => (
              <button key={a.id} onClick={() => setSel(a)} className={cx("block w-full px-4 py-2.5 text-right", sel?.id === a.id ? "bg-brand-50 dark:bg-brand-700/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-800")}>
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-zinc-500">{a.due_date ? fmtDate(a.due_date) : "بدون تاريخ"} · {a.semester === 1 ? settings.labels.term1 : settings.labels.term2}{a.max_score ? ` · من ${a.max_score}` : ""}</div>
              </button>
            ))}
          </Card>
        )}
      </div>
      <div>
        {!sel ? <Empty>اختر واجباً لتسجيل حالة كل طالب.</Empty> : (
          <Card className="p-0">
            <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-t-xl border-b border-zinc-100 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
              <b className="flex flex-1 items-center">{sel.title}<Info title="تسجيل الواجب">اضغط حالة كل طالب: منجزة، متأخرة (تُحسب منجزة في السعي)، أو غير منجزة. ضغطة ثانية تمسح الحالة. إذا كان للواجب علامة قصوى، تظهر خانة للعلامة.</Info></b>
              <Button size="sm" variant="secondary" onClick={() => markAll("done")}>الكل منجز</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit(sel)}>تعديل</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(sel)}>حذف</Button>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {students.map((st) => {
                const s = subs[st.id];
                return (
                  <div key={st.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="min-w-[160px] flex-1">{st.full_name}</span>
                    {STATUS.map((x) => (
                      <button key={x.id} onClick={() => setSub(st, { status: s?.status === x.id ? null : x.id })}
                        className={cx("rounded-md px-2.5 py-1 text-xs font-medium", s?.status === x.id ? x.cls : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300")}>
                        {x.label}
                      </button>
                    ))}
                    {sel.max_score ? (
                      <Input key={`${sel.id}-${st.id}-${s?.score ?? ""}`} className="w-20 py-1 text-center" inputMode="decimal" placeholder={`/${sel.max_score}`} defaultValue={s?.score ?? ""}
                        onBlur={(e) => { const v = e.target.value.trim(); setSub(st, { score: v === "" ? null : Number(v) }); }} />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "تعديل الواجب" : "واجب جديد"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="العنوان"><Input autoFocus required value={edit?.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="تاريخ التسليم"><Input type="date" value={edit?.due_date ?? ""} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} /></Field>
            <Field label="العلامة القصوى"><Input type="number" min="0" placeholder="اختياري" value={edit?.max_score ?? ""} onChange={(e) => setEdit({ ...edit, max_score: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="النصف">
              <Select className="w-full" value={edit?.semester ?? (edit?.due_date ? semesterFor(edit.due_date, settings) : 1)} onChange={(e) => setEdit({ ...edit, semester: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>{settings.labels.term1}</option><option value={2}>{settings.labels.term2}</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button><Button>حفظ</Button></div>
        </form>
      </Modal>
    </div>
  );
}
