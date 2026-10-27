"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadSubjectGrades } from "@/lib/class-data";
import type { AggMap } from "@/lib/behavior";
import { exportCsv, exportXlsx } from "@/lib/excel";
import { gradeSheet } from "@/lib/exports";
import { SEM_OF, bandFor, computeRow, fmt, progressFromBehavior, type Entries, type Result } from "@/lib/grades";
import { WEIGHT_KEYS, effectiveSettings, type Component, type SubjectWeights } from "@/lib/settings";
import type { Student, Subject } from "@/lib/types";
import { useSettings } from "./settings-provider";
import Link from "next/link";
import { Info } from "./info";
import { Button, Card, Empty, Field, Input, Spinner, confirmAction, cx, useToast } from "./ui";

type Col = { key: Component | "sem1" | "sem2" | "final"; input: boolean };
const COLS: Col[] = [
  { key: "p1", input: true }, { key: "p2", input: true }, { key: "m1", input: true }, { key: "pr1", input: true }, { key: "sem1", input: false },
  { key: "p3", input: true }, { key: "p4", input: true }, { key: "m2", input: true }, { key: "pr2", input: true }, { key: "sem2", input: false },
  { key: "final", input: false },
];

function COL_INFO(key: string, L: Record<string, string>, g: { max_periodic: number; max_midterm: number; max_progress: number; periodic_weight: number; midterm_weight: number; scale: number; progress_mode: string; sem1_weight: number; sem2_weight: number; progress1_weight: number; progress2_weight: number }) {
  if (/^p\d$/.test(key)) return `امتحان فصل، يُدخل من ${g.max_periodic}. اكتب «م» إذا كان الطالب معفى.`;
  if (/^m\d$/.test(key)) return `امتحان النصف، يُدخل من ${g.max_midterm}. اكتب «م» إذا كان الطالب معفى.`;
  if (/^pr\d$/.test(key)) return g.progress_mode === "behavior"
    ? `يُحسب تلقائياً من السلوك والوظائف (الرقم الرمادي). اكتب علامة من ${g.max_progress} لتستبدل المحسوبة، أو امسحها للرجوع إلى المحسوبة.`
    : `علامة السعي، تُدخل يدوياً من ${g.max_progress}.`;
  if (key === "sem1" || key === "sem2") return `محسوب: (معدل الفصلين × ${g.periodic_weight} + النصف × ${g.midterm_weight}) ÷ ${g.periodic_weight + g.midterm_weight}، من ${g.scale}. NC = تنقص علامة.`;
  if (key === "final") return `محسوب: ${L.sem1} × ${g.sem1_weight} + ${L.sem2} × ${g.sem2_weight} + ${L.pr1} × ${g.progress1_weight} + ${L.pr2} × ${g.progress2_weight}.`;
  return "";
}

type Change = { student: string; comp: Component; before: Entries[Component]; after: Entries[Component] };

export function GradeGrid({ subject, className, students }: { subject: Subject; className: string; students: Student[] }) {
  const { settings, loaded, subjectWeights, saveSubjectWeights } = useSettings();
  const own = subjectWeights[subject.id];
  const eff = useMemo(() => effectiveSettings(settings, own), [settings, own]);
  const toast = useToast();
  const [entries, setEntries] = useState<Record<string, Entries> | null>(null);
  const [agg, setAgg] = useState<AggMap>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(0);
  const undo = useRef<Change[]>([]);
  const g = eff.final.grading;
  const gOf = (c: Component) => eff.sem[SEM_OF[c]].grading;
  const [showWeights, setShowWeights] = useState(false);
  const L = settings.labels as Record<string, string>;

  useEffect(() => {
    if (!loaded) return;
    loadSubjectGrades(subject.id, students, settings, own).then((d) => { setEntries(d.entries); setAgg(d.agg); });
  }, [subject.id, students, settings, loaded, own]);

  const rows = useMemo(() => {
    const out: Record<string, ReturnType<typeof computeRow>> = {};
    for (const st of students) out[st.id] = computeRow(entries?.[st.id] ?? {}, eff, agg[st.id]);
    return out;
  }, [entries, students, eff, agg]);

  const maxFor = (c: Component) => { const gg = gOf(c); return c.startsWith("pr") ? gg.max_progress : c.startsWith("m") ? gg.max_midterm : gg.max_periodic; };

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
    if (!comp.startsWith("pr") || gOf(comp).progress_mode !== "behavior") return "";
    const v = progressFromBehavior(agg[st]?.[SEM_OF[comp]], eff.sem[SEM_OF[comp]]);
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
          كل العلامات من {g.max_periodic === g.max_midterm && g.max_midterm === g.max_progress ? g.max_periodic : `${g.max_periodic} / ${g.max_midterm} / ${g.max_progress}`}
          {g.progress_mode === "behavior" && " · السعي يُحسب من السلوك والوظائف إذا ترك فارغاً"} · اكتب «م» للمعفى
        </span>
        <span className={cx("ms-2 text-xs", saving ? "text-amber-600" : "text-green-600")}>{saving ? "جارٍ الحفظ…" : "✓ محفوظ"}</span>
        <div className="flex-1" />
        <Button size="sm" variant={own ? "primary" : "secondary"} onClick={() => setShowWeights(!showWeights)}>⚖ أوزان المادة{own ? " (خاصة)" : ""}</Button>
        <Button size="sm" variant="secondary" onClick={doUndo}>↶ تراجع</Button>
        <Button size="sm" variant="secondary" onClick={() => { const s = sheet(); exportCsv(s.header, s.rows, `${subject.name}.csv`); }}>CSV</Button>
        <Button size="sm" variant="secondary" onClick={() => exportXlsx([sheet()], `${className} - ${subject.name}.xlsx`)}>تصدير Excel</Button>
      </div>
      {showWeights && (
        <WeightsPanel
          subjectName={subject.name}
          current={Object.fromEntries(WEIGHT_KEYS.map((k) => [k, g[k]])) as SubjectWeights}
          hasOwn={!!own}
          labels={L}
          onSave={async (w) => {
            const err = await saveSubjectWeights(subject.id, w);
            toast(err ? { text: err, kind: "err" } : { text: w ? `حُفظت أوزان ${subject.name}` : "عادت المادة إلى الأوزان العامة", kind: "ok" });
            if (!err) setShowWeights(false);
          }}
          onClose={() => setShowWeights(false)}
        />
      )}
      <p className="mb-2 text-xs text-zinc-500">
        {L.sem1} = (معدل {L.p1.replace(/\s*1$/, "")}ين × {g.periodic_weight} + {L.m1.replace(/\s*1$/, "")} × {g.midterm_weight}) ÷ {g.periodic_weight + g.midterm_weight}
        {" · "}{L.final} = {L.sem1} × {g.sem1_weight} + {L.sem2} × {g.sem2_weight} + {L.pr1} × {g.progress1_weight} + {L.pr2} × {g.progress2_weight}
      </p>
      <Card className="table-scroll p-0">
        <table className="sheet w-full min-w-[900px] text-sm">
          <thead>
            <tr>
              <th className="sticky-c1 w-10">#</th>
              <th className="sticky-c2 min-w-[180px] text-right">الاسم<Info title="الاسم">اضغط على الاسم لفتح إحصائيات الطالب. ترتيب الطلاب يُغيَّر من صفحة الصف ← الطلاب (سحب وإفلات).</Info></th>
              {COLS.map((c) => (
                <th key={c.key} className={cx("min-w-[76px]", !c.input && "bg-brand-50 dark:bg-brand-700/30")}>{L[c.key]}<Info title={L[c.key]}>{COL_INFO(c.key, L, g)}</Info></th>
              ))}
              <th className="w-20">التقدير<Info title="التقدير">حسب علامة النهائي وسلّم التقديرات في الإعدادات ← حساب العلامات.</Info></th>
            </tr>
          </thead>
          <tbody>
            {students.map((st, r) => {
              const row = rows[st.id];
              const band = bandFor(row.final, eff.final);
              let ci = -1;
              return (
                <tr key={st.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="sticky-c1 text-center text-zinc-400">{r + 1}</td>
                  <td className="sticky-c2 whitespace-nowrap px-2"><Link href={`/student?id=${st.id}`} className="hover:text-brand-600 hover:underline">{st.full_name}</Link></td>
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
              <td className="sticky-c1 bg-zinc-50 dark:bg-zinc-800" />
              <td className="sticky-c2 bg-zinc-50 px-2 py-2 dark:bg-zinc-800">معدل الصف<Info title="معدل الصف">متوسط العمود لكل الطلاب الذين لهم نتيجة رقمية (NC والفارغ لا يدخلان).</Info></td>
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

function WeightsPanel({ subjectName, current, hasOwn, labels: L, onSave, onClose }: {
  subjectName: string; current: SubjectWeights; hasOwn: boolean; labels: Record<string, string>;
  onSave: (w: SubjectWeights | null) => void; onClose: () => void;
}) {
  const [w, setW] = useState<SubjectWeights>(current);
  const f = (k: (typeof WEIGHT_KEYS)[number], label: string) => (
    <Field key={k} label={label}>
      <Input type="number" step="any" min="0" value={w[k] ?? ""} onChange={(e) => setW({ ...w, [k]: e.target.value === "" ? undefined : Number(e.target.value) })} />
    </Field>
  );
  const base = (x: string) => x.replace(/\s*1$/, "");
  const finalSum = (w.sem1_weight ?? 0) + (w.sem2_weight ?? 0) + (w.progress1_weight ?? 0) + (w.progress2_weight ?? 0);
  return (
    <Card className="mb-4 border-brand-500">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex flex-wrap items-center font-semibold">أوزان {subjectName}<Info title="أوزان المادة">هذه الأوزان تخص هذه المادة فقط وتتقدّم على الأوزان العامة في الإعدادات، للنصفين. «الرجوع للأوزان العامة» يلغيها.</Info> <span className="text-xs font-normal text-zinc-500">— تطبَّق على هذه المادة فقط</span></h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700" aria-label="إغلاق">✕</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {f("periodic_weight", `وزن معدل ${base(L.p1)}ين داخل ${base(L.sem1)}`)}
        {f("midterm_weight", `وزن ${base(L.m1)} داخل ${base(L.sem1)}`)}
        <div className="hidden lg:block" />
        {f("sem1_weight", `وزن ${L.sem1} في ${L.final}`)}
        {f("sem2_weight", `وزن ${L.sem2} في ${L.final}`)}
        <div className="hidden lg:block" />
        {f("progress1_weight", `وزن ${L.pr1} في ${L.final}`)}
        {f("progress2_weight", `وزن ${L.pr2} في ${L.final}`)}
      </div>
      {Math.abs(finalSum - 1) > 0.001 && <p className="mt-2 text-xs text-amber-600">مجموع أوزان {L.final} = {finalSum} (يُقسَم الناتج على المجموع).</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {hasOwn && <Button variant="ghost" onClick={() => confirmAction("إلغاء الأوزان الخاصة والرجوع إلى أوزان الإعدادات العامة؟") && onSave(null)}>الرجوع للأوزان العامة</Button>}
        <Button onClick={() => onSave(w)}>حفظ لهذه المادة</Button>
      </div>
    </Card>
  );
}
