"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadSubjectGrades } from "@/lib/class-data";
import type { AggMap } from "@/lib/behavior";
import { exportCsv, exportXlsx } from "@/lib/excel";
import { gradeSheet } from "@/lib/exports";
import { bandFor, computeRow, fmt, progressFromBehavior, type Entries, type Result } from "@/lib/grades";
import type { Component } from "@/lib/settings";
import type { Student, Subject } from "@/lib/types";
import { useSettings } from "./settings-provider";
import { Button, Card, Empty, Spinner, cx, useToast } from "./ui";

type Col = { key: Component | "sem1" | "sem2" | "final"; input: boolean };
const COLS: Col[] = [
  { key: "p1", input: true }, { key: "p2", input: true }, { key: "m1", input: true }, { key: "pr1", input: true }, { key: "sem1", input: false },
  { key: "p3", input: true }, { key: "p4", input: true }, { key: "m2", input: true }, { key: "pr2", input: true }, { key: "sem2", input: false },
  { key: "final", input: false },
];

type Change = { student: string; comp: Component; before: Entries[Component]; after: Entries[Component] };

export function GradeGrid({ subject, className, students }: { subject: Subject; className: string; students: Student[] }) {
  const { settings, loaded } = useSettings();
  const toast = useToast();
  const [entries, setEntries] = useState<Record<string, Entries> | null>(null);
  const [agg, setAgg] = useState<AggMap>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(0);
  const undo = useRef<Change[]>([]);
  const g = settings.grading;
  const L = settings.labels as Record<string, string>;

  useEffect(() => {
    if (!loaded) return;
    loadSubjectGrades(subject.id, students, settings).then((d) => { setEntries(d.entries); setAgg(d.agg); });
  }, [subject.id, students, settings, loaded]);

  const rows = useMemo(() => {
    const out: Record<string, ReturnType<typeof computeRow>> = {};
    for (const st of students) out[st.id] = computeRow(entries?.[st.id] ?? {}, settings, agg[st.id]);
    return out;
  }, [entries, students, settings, agg]);

  const maxFor = (c: Component) => (c.startsWith("pr") ? g.max_progress : c.startsWith("m") ? g.max_midterm : g.max_periodic);

  const persist = useCallback(async (student: string, comp: Component, val: Entries[Component]) => {
    setSaving((n) => n + 1);
    const sb = supabase();
    const { error } = !val
      ? await sb.from("grade_entries").delete().match({ subject_id: subject.id, student_id: student, component: comp })
      : await sb.from("grade_entries").upsert(
          { subject_id: subject.id, student_id: student, component: comp, score: val.score, excused: !!val.excused, updated_at: new Date().toISOString() },
          { onConflict: "subject_id,student_id,component" },
        );
    setSaving((n) => n - 1);
    if (error) toast({ text: "لم يتم الحفظ: " + error.message, kind: "err" });
  }, [subject.id, toast]);

  const setValue = useCallback((student: string, comp: Component, val: Entries[Component], before?: Entries[Component] | null) => {
    if (before !== null) undo.current.push({ student, comp, before, after: val });
    setEntries((prev) => {
      const next = { ...(prev ?? {}) };
      next[student] = { ...(next[student] ?? {}) };
      if (val) next[student][comp] = val;
      else delete next[student][comp];
      return next;
    });
    persist(student, comp, val);
  }, [persist]);

  function commit(student: string, comp: Component, raw: string) {
    const key = `${student}:${comp}`;
    setDrafts((d) => { const n = { ...d }; delete n[key]; return n; });
    const t = raw.trim().replace(",", ".").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const cur = entries?.[student]?.[comp];
    let val: Entries[Component];
    if (t === "") val = undefined;
    else if (/^(م|معفى|معفي|x|e|ex)$/i.test(t)) val = { score: null, excused: true };
    else {
      const n = Number(t);
      if (Number.isNaN(n) || n < 0 || n > maxFor(comp)) {
        toast({ text: `القيمة يجب أن تكون بين 0 و ${maxFor(comp)}`, kind: "err" });
        return;
      }
      val = { score: n };
    }
    const same = (!cur && !val) || (cur && val && cur.score === val.score && !!cur.excused === !!val.excused);
    if (!same) setValue(student, comp, val, cur);
  }

  const doUndo = useCallback(() => {
    const c = undo.current.pop();
    if (!c) return toast({ text: "لا يوجد ما يمكن التراجع عنه", kind: "ok" });
    setValue(c.student, c.comp, c.before, null);
    toast({ text: "تم التراجع", kind: "ok" });
  }, [setValue, toast]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !(e.target as HTMLElement).matches("input")) {
        e.preventDefault();
        doUndo();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doUndo]);

  function nav(e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    let nr = r, nc = c;
    if (e.key === "Enter" || e.key === "ArrowDown") nr = r + 1;
    else if (e.key === "ArrowUp") nr = r - 1;
    else if (e.key === "ArrowLeft" && (e.currentTarget.selectionStart ?? 0) >= e.currentTarget.value.length) nc = c + 1; // RTL: اليسار = التالي
    else if (e.key === "ArrowRight" && (e.currentTarget.selectionStart ?? 0) === 0) nc = c - 1;
    else return;
    const el = document.querySelector<HTMLInputElement>(`[data-cell="${nr}-${nc}"]`);
    if (el) { e.preventDefault(); el.focus(); el.select(); }
  }

  if (!entries) return <Spinner />;
  if (!students.length) return <Empty>لا يوجد طلاب في هذا الصف.</Empty>;

  const display = (st: string, comp: Component): string => {
    const k = `${st}:${comp}`;
    if (k in drafts) return drafts[k];
    const e = entries[st]?.[comp];
    if (!e) return "";
    return e.excused ? "معفى" : e.score === null ? "" : String(e.score);
  };
  const placeholder = (st: string, comp: Component): string => {
    if (g.progress_mode !== "behavior" || !comp.startsWith("pr")) return "";
    const v = progressFromBehavior(agg[st]?.[comp === "pr1" ? 1 : 2], settings);
    return v === null ? "" : String(Math.round(v * 100) / 100);
  };

  const sheet = () => gradeSheet(subject, className, students, { entries, agg, rows }, settings);
  const avgOf = (k: "sem1" | "sem2" | "final") => {
    const nums = students.map((s) => rows[s.id][k]).filter((v): v is number => typeof v === "number");
    return nums.length ? (Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100) : null;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">
          الفتري من {g.max_periodic} · الفصل من {g.max_midterm} · السعي من {g.max_progress}
          {g.progress_mode === "behavior" && " (يُحسب من السلوك إذا ترك فارغاً)"} · اكتب «م» للمعفى
        </span>
        <span className={cx("ms-2 text-xs", saving ? "text-amber-600" : "text-green-600")}>{saving ? "جارٍ الحفظ…" : "✓ محفوظ"}</span>
        <div className="flex-1" />
        <Button size="sm" variant="secondary" onClick={doUndo}>↶ تراجع</Button>
        <Button size="sm" variant="secondary" onClick={() => { const s = sheet(); exportCsv(s.header, s.rows, `${subject.name}.csv`); }}>CSV</Button>
        <Button size="sm" variant="secondary" onClick={() => exportXlsx([sheet()], `${className} - ${subject.name}.xlsx`)}>تصدير Excel</Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="sheet w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th className="min-w-[180px] text-right">الاسم</th>
              {COLS.map((c) => (
                <th key={c.key} className={cx("w-[72px]", !c.input && "bg-brand-50 dark:bg-brand-700/30")}>{L[c.key]}</th>
              ))}
              <th className="w-20">التقدير</th>
            </tr>
          </thead>
          <tbody>
            {students.map((st, r) => {
              const row = rows[st.id];
              const band = bandFor(row.final, settings);
              let ci = -1;
              return (
                <tr key={st.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="text-center text-zinc-400">{r + 1}</td>
                  <td className="whitespace-nowrap px-2">{st.full_name}</td>
                  {COLS.map((c) => {
                    if (!c.input) {
                      const v = row[c.key] as Result;
                      return (
                        <td key={c.key} className={cx("bg-brand-50/60 text-center font-semibold tabular-nums dark:bg-brand-700/20",
                          typeof v === "number" && v < g.pass_mark && "text-red-600", v === "NC" && "text-amber-600")}>{fmt(v)}</td>
                      );
                    }
                    ci++;
                    const comp = c.key as Component;
                    const col = ci;
                    return (
                      <td key={c.key} className="p-0">
                        <input
                          data-cell={`${r}-${col}`}
                          className="grid-cell"
                          inputMode="decimal"
                          aria-label={`${st.full_name} ${L[comp]}`}
                          value={display(st.id, comp)}
                          placeholder={placeholder(st.id, comp)}
                          onFocus={(e) => e.currentTarget.select()}
                          onChange={(e) => setDrafts((d) => ({ ...d, [`${st.id}:${comp}`]: e.target.value }))}
                          onBlur={(e) => commit(st.id, comp, e.target.value)}
                          onKeyDown={(e) => nav(e, r, col)}
                        />
                      </td>
                    );
                  })}
                  <td className="text-center text-xs font-medium" style={{ color: band?.color }}>{band?.label}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-800/50">
              <td colSpan={2} className="px-2 py-2">معدل الصف</td>
              {COLS.map((c) => (
                <td key={c.key} className="text-center tabular-nums">
                  {c.key === "sem1" || c.key === "sem2" || c.key === "final" ? avgOf(c.key) ?? "" : ""}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>
      <p className="mt-2 text-xs text-zinc-500">Enter أو ↓ للانتقال للطالب التالي · الأسهم للتنقل · Ctrl+Z للتراجع · الحفظ تلقائي</p>
    </div>
  );
}
