"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassFull, type SubjectGrades } from "@/lib/class-data";
import { fmtDate, today } from "@/lib/dates";
import { bandFor, fmt, semesterValue, type GradeRow } from "@/lib/grades";
import { overallSem } from "@/lib/compare";
import { attendance, addAtt, classStats, rankOf, ranking, type Attendance } from "@/lib/stats";
import type { Component, Settings } from "@/lib/settings";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { Info } from "@/components/info";
import { Button, Card, Empty, PageHeader, Select, Spinner, cx, useToast } from "@/components/ui";

type Period = "1" | "2" | "year";
type Data = { cls: ClassRow; students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades> };

export default function ReportPage() {
  return <Suspense fallback={<Spinner />}><Inner /></Suspense>;
}
function Inner() {
  const q = useSearchParams();
  const cls = q.get("class") ?? "";
  return <ReportView key={cls} classId={cls} studentId={q.get("student")} />;
}

/** نص مقترح لملاحظة الأستاذ حسب العلامة والحضور. */
function suggestions(v: number | null, att: Attendance, s: Settings): string[] {
  const out: string[] = [];
  if (v !== null) {
    if (v >= 16) out.push("أداء ممتاز، استمر على هذا المستوى.");
    else if (v >= 14) out.push("أداء جيد جداً، ويمكنك الوصول إلى الأفضل.");
    else if (v >= s.grading.pass_mark) out.push("أداء مقبول، يحتاج إلى مزيد من الجهد والمتابعة.");
    else out.push("النتيجة دون المستوى المطلوب، يجب المتابعة والمراجعة المستمرة.");
  }
  if (att.absent + att.excused >= 5) out.push("يُرجى الالتزام بالحضور.");
  if (att.disruption >= 3) out.push("يُطلب تحسين السلوك داخل الصف.");
  if (att.participation >= 10) out.push("مشاركة فعّالة في الصف.");
  if (att.hwMissing >= 3) out.push("يجب الاهتمام بإنجاز الوظائف.");
  return out;
}

function ReportView({ classId, studentId }: { classId: string; studentId: string | null }) {
  const { settings, loaded, subjectWeights } = useSettings();
  const toast = useToast();
  const R = settings.report;
  const L = settings.labels as Record<string, string>;
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [period, setPeriod] = useState<Period>(() => (today() <= settings.year.sem1_end ? "1" : "2"));
  const [only, setOnly] = useState<string>(studentId ?? "all");
  const [subjSel, setSubjSel] = useState<Set<string> | null>(null);
  const [show, setShow] = useState({ rank: R.show_rank, behavior: R.show_behavior, note: R.show_note });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesKey = `report_notes:${classId}`;

  useEffect(() => { setShow({ rank: R.show_rank, behavior: R.show_behavior, note: R.show_note }); }, [R.show_rank, R.show_behavior, R.show_note]);
  useEffect(() => {
    if (!loaded || !classId) return;
    (async () => {
      const f = await loadClassFull(classId, settings, subjectWeights);
      if (!f.cls) return setD(null);
      setD({ cls: f.cls, students: f.students, subjects: f.subjects, data: f.data });
      const { data } = await supabase().from("settings").select("value").eq("key", notesKey).maybeSingle();
      setNotes((data?.value as Record<string, string>) ?? {});
    })();
  }, [classId, loaded, settings, subjectWeights, notesKey]);

  function setNote(id: string, text: string) {
    const next = { ...notes, [id]: text };
    setNotes(next);
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      const { data: u } = await supabase().auth.getUser();
      if (!u.user) return;
      const { error } = await supabase().from("settings").upsert({ owner_id: u.user.id, key: notesKey, value: next, updated_at: new Date().toISOString() });
      if (error) toast({ text: "لم تُحفظ الملاحظة: " + error.message, kind: "err" });
    }, 600);
  }

  const subjects = useMemo(() => (d ? d.subjects.filter((x) => !subjSel || subjSel.has(x.id)) : []), [d, subjSel]);
  if (!classId) return <Empty>اختر صفاً من صفحة الصف ← «تقارير PDF».</Empty>;
  if (d === undefined) return <Spinner />;
  if (d === null) return <Empty>الصف غير موجود.</Empty>;

  const periodName = period === "1" ? L.term1 : period === "2" ? L.term2 : "السنة الدراسية";
  const title = R.title.trim() || `كشف علامات ${periodName}`;
  const sem = period === "year" ? undefined : (Number(period) as 1 | 2);
  const cs = classStats(d.students, subjects, d.data, settings);
  const periodOverall = (st: Student): { value: number | null; partial: boolean } => {
    if (sem) return overallSem(st.id, subjects, d.data, sem);
    const f = cs.finalOverall[st.id];
    if (typeof f === "number") return { value: f, partial: false };
    const o = cs.overall[st.id];
    return { value: typeof o === "number" ? o : null, partial: typeof o === "number" };
  };
  const ranked = ranking(d.students, (st) => periodOverall(st).value);
  const list = only === "all" ? d.students : d.students.filter((s) => s.id === only);
  const imgs = settings.report_images;
  const logo = imgs.logo || settings.profile.logo_url;
  const cols: { key: Component | "sem1" | "sem2" | "final"; label: string }[] = sem === 1
    ? [{ key: "p1", label: L.p1 }, { key: "p2", label: L.p2 }, { key: "m1", label: L.m1 }, { key: "pr1", label: L.pr1 }, { key: "sem1", label: L.sem1 }]
    : sem === 2
    ? [{ key: "p3", label: L.p3 }, { key: "p4", label: L.p4 }, { key: "m2", label: L.m2 }, { key: "pr2", label: L.pr2 }, { key: "sem2", label: L.sem2 }]
    : [{ key: "sem1", label: L.sem1 }, { key: "sem2", label: L.sem2 }, { key: "pr1", label: L.pr1 }, { key: "pr2", label: L.pr2 }, { key: "final", label: L.final }];

  const valueOf = (row: GradeRow | undefined, key: string): { v: string; partial: boolean; n: number | null } => {
    if (!row) return { v: "", partial: false, n: null };
    if (key === "sem1" || key === "sem2") {
      const x = semesterValue(row, key === "sem1" ? 1 : 2);
      return { v: x.value === null ? (row[key] === "NC" ? "NC" : "") : String(x.value), partial: x.partial, n: x.value };
    }
    if (key === "final") {
      if (typeof row.final === "number") return { v: String(row.final), partial: false, n: row.final };
      return { v: row.current !== null ? String(row.current) : fmt(row.final), partial: row.current !== null, n: row.current };
    }
    const r = row[key as Component];
    return { v: fmt(r), partial: false, n: typeof r === "number" ? r : null };
  };
  const mainKey = cols[cols.length - 1].key;

  return (
    <div>
      <div className="no-print">
        <div className="mb-2 text-sm text-zinc-500"><Link href="/classes" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${d.cls.id}`} className="hover:underline">{d.cls.name}</Link> ‹ تقارير PDF</div>
        <PageHeader title="تقرير PDF لكل طالب" sub={`${d.cls.name} · صفحة A4 لكل طالب`}
          info="اضغط «طباعة / حفظ PDF» ثم اختر «حفظ بصيغة PDF» في نافذة الطباعة. كل طالب في صفحة واحدة. الشعار والتوقيع من الإعدادات ← الملف الشخصي، والقيم الافتراضية من الإعدادات ← التقرير."
          actions={<Button onClick={() => window.print()}>طباعة / حفظ PDF ({list.length} {list.length === 1 ? "صفحة" : "صفحات"})</Button>} />
        <Card className="mb-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">الفترة
              <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="1">{L.term1}</option><option value="2">{L.term2}</option><option value="year">السنة كلها</option>
              </Select>
            </label>
            <label className="flex items-center gap-2">الطلاب
              <Select value={only} onChange={(e) => setOnly(e.target.value)}>
                <option value="all">الصف كله ({d.students.length})</option>
                {d.students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </Select>
            </label>
            {(["rank", "behavior", "note"] as const).map((k) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
                {k === "rank" ? "الترتيب" : k === "behavior" ? "الحضور والسلوك" : "ملاحظة الأستاذ"}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="me-1">المواد:</span>
            {d.subjects.map((sj) => {
              const on = !subjSel || subjSel.has(sj.id);
              return (
                <button key={sj.id} type="button" onClick={() => {
                  const cur = new Set(subjSel ?? d.subjects.map((x) => x.id));
                  if (on) cur.delete(sj.id); else cur.add(sj.id);
                  setSubjSel(cur);
                }} className={cx("rounded-md px-2 py-1 text-xs", on ? "bg-brand-500 text-white" : "bg-zinc-100 line-through dark:bg-zinc-800")}>{sj.name}</button>
              );
            })}
          </div>
          {!imgs.signature && <p className="text-xs text-amber-700 dark:text-amber-400">لا يوجد توقيع بعد: الإعدادات ← الملف الشخصي ← «توقيع الأستاذ».</p>}
        </Card>
      </div>

      <div className="report-pages space-y-6">
        {list.map((st) => {
          let att: Attendance = attendance(undefined);
          for (const sj of subjects) att = addAtt(att, attendance(d.data[sj.id], st.id, sem));
          const ov = periodOverall(st);
          const band = bandFor(ov.value, settings);
          const rank = rankOf(ranked, st.id);
          return (
            <article key={st.id} className="report-page mx-auto flex max-w-[210mm] flex-col rounded-xl border border-zinc-200 bg-white p-8 text-[13px] text-zinc-900 shadow-sm print:rounded-none print:border-0 print:p-0 print:shadow-none dark:border-zinc-700">
              <header className="mb-4 flex items-center gap-4 border-b-2 border-zinc-800 pb-3">
                {logo && <img src={logo} alt="" className="h-16 w-16 object-contain" />}
                <div className="flex-1">
                  <div className="text-base font-bold">{settings.profile.school_name}</div>
                  <div className="text-xs text-zinc-600">السنة الدراسية {d.cls.school_year ?? settings.year.school_year}</div>
                </div>
                <h1 className="text-xl font-bold">{title}</h1>
              </header>
              <section className="mb-4 grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-3 print:bg-zinc-100">
                <div><span className="text-zinc-500">الاسم: </span><b>{st.full_name}</b></div>
                <div><span className="text-zinc-500">الصف: </span><b>{d.cls.name}</b></div>
                <div><span className="text-zinc-500">الرقم: </span><b>{st.student_number ?? "—"}</b></div>
              </section>
              <table className="mb-4 w-full border-collapse text-center">
                <thead>
                  <tr className="bg-zinc-100 print:bg-zinc-200">
                    <th className="border border-zinc-400 px-2 py-1.5 text-right">المادة</th>
                    {cols.map((c) => <th key={c.key} className="border border-zinc-400 px-1 py-1.5 font-semibold">{c.label}</th>)}
                    <th className="border border-zinc-400 px-1 py-1.5">التقدير</th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((sj) => {
                    const row = d.data[sj.id]?.rows[st.id];
                    const main = valueOf(row, mainKey);
                    const b = bandFor(main.n, settings);
                    return (
                      <tr key={sj.id}>
                        <td className="border border-zinc-400 px-2 py-1 text-right font-medium">{sj.name}</td>
                        {cols.map((c) => {
                          const x = valueOf(row, c.key);
                          return <td key={c.key} className={cx("border border-zinc-400 px-1 py-1 tabular-nums", c.key === mainKey && "font-bold", x.n !== null && x.n < settings.grading.pass_mark && "text-red-700")}>{x.v}{x.partial && "*"}</td>;
                        })}
                        <td className="border border-zinc-400 px-1 py-1">{b?.label ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <section className="mb-4 flex flex-wrap items-center gap-x-8 gap-y-1 rounded-lg border border-zinc-300 p-3">
                <div className="text-base">المعدل العام: <b className="tabular-nums">{ov.value ?? "—"}{ov.partial && "*"}</b> / {settings.grading.scale}</div>
                {band && <div className="text-base">التقدير: <b>{band.label}</b></div>}
                {show.rank && rank && <div>الترتيب في الصف: <b>{rank}</b> من {ranked.length}</div>}
              </section>
              {show.behavior && (
                <section className="mb-4">
                  <h2 className="mb-1 font-semibold">الحضور والسلوك</h2>
                  <table className="w-full border-collapse text-center">
                    <thead><tr className="bg-zinc-100 print:bg-zinc-200">{[`${L.absent} ${L.excused}`, `${L.absent} ${L.unexcused}`, L.late, `${L.homework}: ${L.hw_done}`, `${L.homework}: ${L.hw_missing}`, L.participation, L.disruption].map((h) => <th key={h} className="border border-zinc-400 px-1 py-1 font-medium">{h}</th>)}</tr></thead>
                    <tbody><tr>{[att.excused, att.absent, att.late, att.hwDone, att.hwMissing, att.participation, att.disruption].map((v, i) => <td key={i} className="border border-zinc-400 py-1 tabular-nums">{v}</td>)}</tr></tbody>
                  </table>
                </section>
              )}
              {show.note && (
                <section className="mb-4">
                  <h2 className="mb-1 font-semibold">ملاحظة الأستاذ</h2>
                  <textarea rows={2} value={notes[st.id] ?? ""} onChange={(e) => setNote(st.id, e.target.value)} placeholder="اكتب ملاحظة لهذا الطالب…"
                    className="no-print w-full rounded border border-zinc-300 p-2 text-[13px] dark:bg-white" />
                  <div className="no-print mt-1 flex flex-wrap gap-1">
                    {suggestions(ov.value, att, settings).map((t) => (
                      <button key={t} type="button" onClick={() => setNote(st.id, ((notes[st.id] ?? "").trim() + " " + t).trim())} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-brand-50">+ {t}</button>
                    ))}
                  </div>
                  <p className="hidden min-h-[3em] whitespace-pre-wrap rounded border border-zinc-300 p-2 print:block">{notes[st.id] ?? ""}</p>
                </section>
              )}
              <footer className="mt-auto grid grid-cols-3 items-end gap-4 border-t border-zinc-300 pt-3 text-xs">
                <div><div className="text-zinc-500">الأستاذ</div><div className="font-semibold">{settings.profile.teacher_name}</div></div>
                <div className="text-center">
                  {imgs.signature ? <img src={imgs.signature} alt="التوقيع" className="mx-auto h-14 object-contain" /> : <div className="h-14" />}
                  <div className="text-zinc-500">التوقيع · {fmtDate(today())}</div>
                </div>
                <div className="text-left"><div className="h-14 border-b border-dashed border-zinc-400" /><div className="text-zinc-500">توقيع الأهل</div></div>
              </footer>
              {subjects.some((sj) => valueOf(d.data[sj.id]?.rows[st.id], mainKey).partial) || ov.partial ? <p className="mt-1 text-[10px] text-zinc-500">* حتى الآن (علامات ناقصة)</p> : null}
            </article>
          );
        })}
      </div>
      <p className="no-print mt-4 text-center text-xs text-zinc-500">كل العلامات من {settings.grading.scale}، مطابقة لكشف العلامات.<Info title="كيف أحفظ PDF؟">في نافذة الطباعة اختر الطابعة «حفظ بصيغة PDF» (Save as PDF). صفحة واحدة لكل طالب، حجم A4.</Info></p>
    </div>
  );
}
