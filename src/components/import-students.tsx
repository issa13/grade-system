"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { readTable } from "@/lib/excel";
import type { Student } from "@/lib/types";
import { Button, Field, Modal, Select, useToast } from "./ui";

const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[أإآ]/g, "ا").replace(/ة$/g, "ه").trim().toLowerCase();
const NAME_RE = /^(الاسم|اسم الطالب|الاسم الكامل|name|full ?name|student ?name)$/i;
const NUM_RE = /^(الرقم|رقم|#|no\.?|number|student ?number|id)$/i;

export function ImportStudents({ open, onClose, classId, existing, onDone }: {
  open: boolean; onClose: () => void; classId: string; existing: Student[]; onDone: () => void;
}) {
  const toast = useToast();
  const [table, setTable] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [nameCol, setNameCol] = useState(-1);
  const [numCol, setNumCol] = useState(-1);
  const [notesCol, setNotesCol] = useState(-1);
  const [dupMode, setDupMode] = useState<"skip" | "update">("skip");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");

  async function onFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    try {
      const t = await readTable(f);
      setTable(t);
      // اكتشاف سطر العناوين تلقائياً (مثلاً ملف كشف العلامات حيث العناوين في السطر 8)
      let h = -1, nc = -1, uc = -1;
      for (let i = 0; i < Math.min(t.length, 20) && h < 0; i++) {
        const idx = t[i].findIndex((c) => NAME_RE.test(c));
        if (idx >= 0) { h = i; nc = idx; uc = t[i].findIndex((c) => NUM_RE.test(c)); }
      }
      if (h < 0) { h = -1; nc = 0; }
      setHeaderRow(h);
      setNameCol(nc);
      setNumCol(uc);
      setNotesCol(-1);
    } catch (e) {
      toast({ text: "تعذّرت قراءة الملف: " + (e as Error).message, kind: "err" });
    }
  }

  const header = headerRow >= 0 ? table[headerRow] ?? [] : (table[0] ?? []).map((_, i) => `عمود ${i + 1}`);
  const existingMap = useMemo(() => new Map(existing.map((s) => [norm(s.full_name), s])), [existing]);

  const preview = useMemo(() => {
    if (nameCol < 0) return [];
    const seen = new Set<string>();
    return table.slice(headerRow + 1).map((r) => {
      const name = (r[nameCol] ?? "").replace(/\s+/g, " ").trim();
      const number = numCol >= 0 ? r[numCol] ?? "" : "";
      const notes = notesCol >= 0 ? r[notesCol] ?? "" : "";
      const key = norm(name);
      const dupExisting = existingMap.get(key);
      const dupInFile = seen.has(key);
      seen.add(key);
      return { name, number, notes, dupExisting, dupInFile };
    }).filter((r) => r.name && !/^\d+(\.\d+)?$/.test(r.name));
  }, [table, headerRow, nameCol, numCol, notesCol, existingMap]);

  async function confirm() {
    setBusy(true);
    const toInsert = preview.filter((r) => !r.dupExisting && !r.dupInFile);
    const toUpdate = dupMode === "update" ? preview.filter((r) => r.dupExisting) : [];
    const base = existing.length;
    if (toInsert.length) {
      const { error } = await supabase().from("students").insert(
        toInsert.map((r, i) => ({ class_id: classId, full_name: r.name, student_number: r.number || null, notes: r.notes || null, sort_order: base + i + 1 })),
      );
      if (error) { setBusy(false); return toast({ text: error.message, kind: "err" }); }
    }
    for (const r of toUpdate) {
      await supabase().from("students").update({
        student_number: r.number || r.dupExisting!.student_number,
        notes: r.notes || r.dupExisting!.notes,
      }).eq("id", r.dupExisting!.id);
    }
    setBusy(false);
    toast({ text: `أُضيف ${toInsert.length} طالب${toUpdate.length ? `، وحُدّث ${toUpdate.length}` : ""}`, kind: "ok" });
    setTable([]);
    onDone();
    onClose();
  }

  const colOptions = (
    <>
      <option value={-1}>—</option>
      {header.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}
    </>
  );
  const dups = preview.filter((r) => r.dupExisting || r.dupInFile).length;

  return (
    <Modal open={open} onClose={onClose} title="استيراد الطلاب من Excel" wide>
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 p-6 text-sm text-zinc-500 hover:border-brand-500 dark:border-zinc-700">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{fileName || "اختر ملف .xlsx أو .xlsm أو .csv"}</span>
          <span className="mt-1 text-xs">يمكن استعمال ملف كشف العلامات مباشرة — سيتم التعرّف على عمود "الاسم"</span>
          <input type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        {table.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="سطر العناوين">
                <Select className="w-full" value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                  <option value={-1}>لا يوجد</option>
                  {table.slice(0, 20).map((r, i) => <option key={i} value={i}>السطر {i + 1}: {r.filter(Boolean).slice(0, 3).join(" | ")}</option>)}
                </Select>
              </Field>
              <Field label="عمود الاسم *"><Select className="w-full" value={nameCol} onChange={(e) => setNameCol(Number(e.target.value))}>{colOptions}</Select></Field>
              <Field label="عمود الرقم"><Select className="w-full" value={numCol} onChange={(e) => setNumCol(Number(e.target.value))}>{colOptions}</Select></Field>
              <Field label="عمود الملاحظات"><Select className="w-full" value={notesCol} onChange={(e) => setNotesCol(Number(e.target.value))}>{colOptions}</Select></Field>
            </div>

            {dups > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                <span>يوجد {dups} اسم مكرر (موجود في الصف أو مكرر في الملف).</span>
                <Select value={dupMode} onChange={(e) => setDupMode(e.target.value as "skip" | "update")}>
                  <option value="skip">تخطّي المكرر</option>
                  <option value="update">تحديث بيانات الموجود</option>
                </Select>
              </div>
            )}

            <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="sheet w-full text-sm">
                <thead>
                  <tr><th className="sticky-c1 p-2 text-right">#</th><th className="sticky-c2 p-2 text-right">الاسم</th><th className="p-2 text-right">الرقم</th><th className="p-2 text-right">الحالة</th></tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i}>
                      <td className="sticky-c1 p-2 text-zinc-400">{i + 1}</td>
                      <td className="sticky-c2 p-2">{r.name}</td>
                      <td className="p-2">{r.number}</td>
                      <td className="p-2">
                        {r.dupExisting ? <span className="text-amber-600">موجود</span> : r.dupInFile ? <span className="text-amber-600">مكرر في الملف</span> : <span className="text-green-600">جديد</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>إلغاء</Button>
              <Button disabled={busy || preview.length === 0} onClick={confirm}>تأكيد الاستيراد ({preview.length})</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
