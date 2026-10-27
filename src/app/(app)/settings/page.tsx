"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSettings } from "@/components/settings-provider";
import { COMPONENTS, DEFAULT_SETTINGS, SECTION_TITLES, type Settings, type SettingsKey } from "@/lib/settings";
import { downloadJson } from "@/lib/excel";
import { WEEKDAYS } from "@/lib/types";
import { Button, Card, Field, Input, PageHeader, Select, Spinner, confirmAction, cx, useToast } from "@/components/ui";

const FIELD_LABELS: Record<string, string> = {
  teacher_name: "اسم الأستاذ", school_name: "اسم المدرسة", logo_url: "رابط الشعار (اختياري)", theme: "المظهر", date_format: "صيغة التاريخ",
  school_year: "السنة الدراسية", start: "بداية السنة", sem1_end: "نهاية الفصل الأول", end: "نهاية السنة",
  scale: "العلامة النهائية من", max_periodic: "الفتري من", max_midterm: "الفصل من", max_progress: "السعي من",
  periodic_weight: "وزن معدل الفتريين داخل النصف", midterm_weight: "وزن الفصل داخل النصف",
  sem1_weight: "وزن النصف الأول في النهائي", sem2_weight: "وزن النصف الثاني في النهائي",
  progress1_weight: "وزن السعي 1 في النهائي", progress2_weight: "وزن السعي 2 في النهائي",
  decimals: "عدد الخانات العشرية", rounding: "طريقة التقريب", pass_mark: "علامة النجاح",
  missing_policy: "عند نقص علامة", progress_mode: "طريقة حساب السعي",
  base: "علامة السعي الأساسية", participation: "نقاط كل مشاركة", disruption: "نقاط كل شغب", late: "نقاط كل تأخير",
  absent_unexcused: "نقاط غياب بدون عذر", absent_excused: "نقاط غياب بعذر", hw_done: "نقاط وظيفة منجزة", hw_missing: "نقاط وظيفة غير منجزة",
  participation_max_per_session: "أقصى عدد مشاركات في الحصة",
  late_threshold_minutes: "يعتبر متأخراً بعد (دقائق)", excused_counts_as_absent: "الغياب بعذر يُحسب غياباً",
  show_semesters: "إظهار علامات النصفين", show_final: "إظهار العلامة النهائية", show_overall: "إظهار المعدل العام",
  show_behavior: "إظهار ملخص السلوك والحضور", show_band: "إظهار التقدير",
  trash_retention_days: "مدة الاحتفاظ بالمحذوفات (أيام)",
};

const ENUMS: Record<string, { v: string; l: string }[]> = {
  theme: [{ v: "system", l: "حسب الجهاز" }, { v: "light", l: "فاتح" }, { v: "dark", l: "داكن" }],
  rounding: [{ v: "round", l: "تقريب عادي" }, { v: "floor", l: "للأسفل" }, { v: "ceil", l: "للأعلى" }],
  missing_policy: [{ v: "nc", l: "إظهار NC (غير مكتمل)" }, { v: "zero", l: "اعتبارها صفراً" }],
  progress_mode: [{ v: "manual", l: "يدوي (يدخله الأستاذ)" }, { v: "behavior", l: "محسوب من السلوك والوظائف" }],
};

const HINTS: Partial<Record<SettingsKey, string>> = {
  grading: "النصف = (معدل الفتريين × وزن الفتري + الفصل × وزن الفصل) ÷ مجموع الوزنين. النهائي = مجموع (كل جزء × وزنه).",
  behavior: "عند اختيار «محسوب من السلوك» في حساب العلامات: السعي = العلامة الأساسية + مجموع النقاط، ضمن 0 والحد الأقصى. القيم السالبة تخصم.",
  visibility: "العلامات غير المحددة هنا لا تظهر للطالب (مفيد لإخفاء امتحان لم يُنشر بعد).",
};

export default function SettingsPage() {
  const { settings, loaded } = useSettings();
  const [section, setSection] = useState<SettingsKey>("grading");
  if (!loaded) return <Spinner />;
  return (
    <div>
      <PageHeader title="الإعدادات" sub="كل القيم قابلة للتعديل وتُحفظ في قاعدة البيانات" />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {(Object.keys(SECTION_TITLES) as SettingsKey[]).map((k) => (
            <button key={k} onClick={() => setSection(k)}
              className={cx("whitespace-nowrap rounded-lg px-3 py-2 text-right text-sm", section === k ? "bg-brand-500 text-white" : "hover:bg-zinc-100 dark:hover:bg-zinc-800")}>
              {SECTION_TITLES[k]}
            </button>
          ))}
        </nav>
        <SectionEditor key={section} k={section} initial={settings[section]} />
      </div>
    </div>
  );
}

function SectionEditor<K extends SettingsKey>({ k, initial }: { k: K; initial: Settings[K] }) {
  const { save, reset } = useSettings();
  const toast = useToast();
  const [v, setV] = useState<Record<string, unknown>>(structuredClone(initial) as Record<string, unknown>);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setV(structuredClone(initial) as Record<string, unknown>); setDirty(false); }, [initial]);

  const set = (key: string, val: unknown) => { setV((o) => ({ ...o, [key]: val })); setDirty(true); };

  async function onSave() {
    if (k === "grading") {
      const g = v as Settings["grading"];
      const sum = Number(g.sem1_weight) + Number(g.sem2_weight) + Number(g.progress1_weight) + Number(g.progress2_weight);
      if (Math.abs(sum - 1) > 0.001 && !confirmAction(`مجموع أوزان النهائي = ${sum} (وليس 1). سيتم تقسيم النتيجة على المجموع. متابعة؟`)) return;
    }
    const err = await save(k, v as Settings[K]);
    toast(err ? { text: err, kind: "err" } : { text: "تم حفظ الإعدادات", kind: "ok" });
    if (!err) setDirty(false);
  }
  async function onReset() {
    if (!confirmAction(`إعادة «${SECTION_TITLES[k]}» إلى القيم الافتراضية؟`)) return;
    const err = await reset(k);
    toast(err ? { text: err, kind: "err" } : { text: "تمت الإعادة", kind: "ok" });
  }

  const def = DEFAULT_SETTINGS[k] as Record<string, unknown>;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{SECTION_TITLES[k]}</h2>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onReset}>إعادة للافتراضي</Button>
          <Button size="sm" disabled={!dirty} onClick={onSave}>حفظ</Button>
        </div>
      </div>
      {HINTS[k] && <p className="mb-4 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">{HINTS[k]}</p>}

      {k === "data" && <DataTools />}

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.keys(def).map((key) => {
          const val = v[key];
          const label = k === "labels" ? `${(DEFAULT_SETTINGS.labels as Record<string, string>)[key]}` : FIELD_LABELS[key] ?? key;

          if (key === "weekend_days") {
            const arr = (val as number[]) ?? [];
            return (
              <Field key={key} label="أيام العطلة الأسبوعية">
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d, i) => (
                    <button key={i} type="button" onClick={() => set(key, arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i])}
                      className={cx("rounded-md px-2 py-1 text-xs", arr.includes(i) ? "bg-brand-500 text-white" : "bg-zinc-100 dark:bg-zinc-800")}>{d}</button>
                  ))}
                </div>
              </Field>
            );
          }
          if (key === "breaks") return <BreaksEditor key={key} value={val as Settings["year"]["breaks"]} onChange={(x) => set(key, x)} />;
          if (key === "bands") return <BandsEditor key={key} value={val as Settings["grading"]["bands"]} onChange={(x) => set(key, x)} />;
          if (key === "components") {
            const arr = (val as string[]) ?? [];
            return (
              <Field key={key} label="العلامات الظاهرة للطالب">
                <div className="flex flex-wrap gap-1">
                  {COMPONENTS.map((c) => (
                    <button key={c} type="button" onClick={() => set(key, arr.includes(c) ? arr.filter((x) => x !== c) : [...arr, c])}
                      className={cx("rounded-md px-2 py-1 text-xs", arr.includes(c) ? "bg-brand-500 text-white" : "bg-zinc-100 line-through dark:bg-zinc-800")}>
                      {(DEFAULT_SETTINGS.labels as Record<string, string>)[c]}
                    </button>
                  ))}
                </div>
              </Field>
            );
          }
          if (ENUMS[key]) {
            return (
              <Field key={key} label={label}>
                <Select className="w-full" value={String(val)} onChange={(e) => set(key, e.target.value)}>
                  {ENUMS[key].map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </Select>
              </Field>
            );
          }
          if (typeof def[key] === "boolean") {
            return (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={!!val} onChange={(e) => set(key, e.target.checked)} />
                {label}
              </label>
            );
          }
          if (typeof def[key] === "number") {
            return (
              <Field key={key} label={label}>
                <Input type="number" step="any" value={val as number} onChange={(e) => set(key, e.target.value === "" ? 0 : Number(e.target.value))} />
              </Field>
            );
          }
          const isDate = ["start", "sem1_end", "end"].includes(key);
          return (
            <Field key={key} label={label}>
              <Input type={isDate ? "date" : "text"} value={(val as string) ?? ""} onChange={(e) => set(key, e.target.value)} />
            </Field>
          );
        })}
      </div>
    </Card>
  );
}

function BreaksEditor({ value, onChange }: { value: Settings["year"]["breaks"]; onChange: (v: Settings["year"]["breaks"]) => void }) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 text-sm font-medium">العطل</div>
      <div className="space-y-2">
        {value.map((b, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Input className="w-40" placeholder="الاسم" value={b.label} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input className="w-40" type="date" value={b.from} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
            <Input className="w-40" type="date" value={b.to} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => onChange([...value, { label: "", from: "", to: "" }])}>+ عطلة</Button>
      </div>
    </div>
  );
}

function BandsEditor({ value, onChange }: { value: Settings["grading"]["bands"]; onChange: (v: Settings["grading"]["bands"]) => void }) {
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 text-sm font-medium">سلّم التقديرات (من الحد الأدنى وما فوق)</div>
      <div className="space-y-2">
        {value.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Input className="w-24" type="number" step="any" value={b.min} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)))} />
            <Input className="w-40" value={b.label} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Input className="h-9 w-14 p-1" type="color" value={b.color} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>✕</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => onChange([...value, { min: 0, label: "", color: "#666666" }])}>+ تقدير</Button>
      </div>
    </div>
  );
}

const BACKUP_TABLES = ["classes", "students", "subjects", "schedule_slots", "sessions", "session_records", "assignments", "assignment_submissions", "grade_entries", "settings"] as const;

function DataTools() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function exportAll() {
    setBusy(true);
    const out: Record<string, unknown[]> = {};
    for (const t of BACKUP_TABLES) {
      const all: unknown[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await supabase().from(t).select("*").range(from, from + 999);
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      out[t] = all;
    }
    downloadJson({ version: 1, exported_at: new Date().toISOString(), tables: out }, `نسخة-احتياطية-${new Date().toISOString().slice(0, 10)}.json`);
    setBusy(false);
  }

  async function importAll(file?: File) {
    if (!file) return;
    if (!confirmAction("سيتم دمج النسخة الاحتياطية مع البيانات الحالية (السجلات بنفس المعرّف ستُستبدل). متابعة؟")) return;
    setBusy(true);
    try {
      const json = JSON.parse(await file.text()) as { tables: Record<string, Record<string, unknown>[]> };
      const { data: u } = await supabase().auth.getUser();
      for (const t of BACKUP_TABLES) {
        const rows = (json.tables[t] ?? []).map((r) => ({ ...r, owner_id: u.user!.id }));
        for (let i = 0; i < rows.length; i += 500) {
          const conflict = t === "settings" ? "owner_id,key" : "id";
          const { error } = await supabase().from(t).upsert(rows.slice(i, i + 500), { onConflict: conflict });
          if (error) throw new Error(`${t}: ${error.message}`);
        }
      }
      toast({ text: "تم استيراد النسخة الاحتياطية", kind: "ok" });
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      toast({ text: "فشل الاستيراد: " + (e as Error).message, kind: "err" });
    }
    setBusy(false);
  }

  return (
    <div className="mb-6 flex flex-wrap gap-2 border-b border-zinc-100 pb-6 dark:border-zinc-800">
      <Button variant="secondary" disabled={busy} onClick={exportAll}>تصدير كل البيانات (نسخة احتياطية)</Button>
      <label className={cx("inline-flex cursor-pointer items-center rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800", busy && "opacity-50")}>
        استيراد نسخة احتياطية
        <input type="file" accept=".json" className="hidden" onChange={(e) => importAll(e.target.files?.[0])} />
      </label>
    </div>
  );
}
