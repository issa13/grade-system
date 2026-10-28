"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassFull, type SubjectGrades } from "@/lib/class-data";
import { addDays } from "@/lib/schedule";
import { fmtDate, today } from "@/lib/dates";
import { absoluteUrl } from "@/lib/paths";
import { classStats } from "@/lib/stats";
import { fmt } from "@/lib/grades";
import { failingSubjects, fillTemplate, normalizePhone, periodStats, prettyPhone, waLink } from "@/lib/whatsapp";
import type { MessageLog, Student, Subject } from "@/lib/types";
import { useSettings } from "./settings-provider";
import { Info } from "./info";
import { Button, Input, Modal, Spinner, cx, useToast } from "./ui";

type Full = { students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades>; className: string };

/**
 * قائمة انتظار رسائل واتساب: الطالب الحالي، رسالته (قابلة للتعديل)، «افتح واتساب»، ثم «التالي».
 * الأستاذ يضغط «إرسال» بنفسه داخل واتساب.
 */
export function WhatsAppQueue({ students, classId, onClose, title }: { students: Student[]; classId: string; onClose: () => void; title?: string }) {
  const { settings, subjectWeights } = useSettings();
  const toast = useToast();
  const [full, setFull] = useState<Full | null>(null);
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [idx, setIdx] = useState(0);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [addPhone, setAddPhone] = useState("");
  const W = settings.whatsapp;

  useEffect(() => {
    (async () => {
      const f = await loadClassFull(classId, settings, subjectWeights);
      const ids = students.map((s) => s.id);
      const { data } = await supabase().from("message_log").select("*").in("student_id", ids).order("sent_at", { ascending: false });
      setLogs((data ?? []) as MessageLog[]);
      setFull({ students: f.students, subjects: f.subjects, data: f.data, className: f.cls?.name ?? "" });
      // أحدث الأرقام من قاعدة البيانات
      const fresh = Object.fromEntries(f.students.map((s) => [s.id, s.phone ?? null]));
      setPhones(Object.fromEntries(students.map((s) => [s.id, fresh[s.id] ?? s.phone ?? null])));
    })();
  }, [classId, students, settings, subjectWeights]);

  const t = today();
  const sentToday = useMemo(() => new Set(logs.filter((l) => l.sent_at.slice(0, 10) === t).map((l) => l.student_id)), [logs, t]);
  const cs = useMemo(() => (full ? classStats(full.students, full.subjects, full.data, settings) : null), [full, settings]);

  const st = students[idx];
  const periodFor = (sid: string) => {
    if (W.period === "since_last") {
      const last = logs.find((l) => l.student_id === sid);
      if (last) return { from: last.sent_at.slice(0, 10), to: t };
    }
    return { from: addDays(t, -6), to: t };
  };

  const messageFor = (s: Student): string => {
    if (!full || !cs) return "";
    const p = periodFor(s.id);
    const ps = periodStats(s.id, full.subjects, full.data, p.from, p.to);
    return fillTemplate(W.template, {
      الاسم: s.full_name,
      الصف: full.className,
      غياب: ps.absent,
      تأخير: ps.late,
      مشاركة: ps.participation,
      شغب: ps.disruption,
      وظائف_ناقصة: ps.hwMissing,
      المعدل: fmt(cs.overall[s.id] ?? null),
      مواد_تحت_النجاح: (() => { const f = failingSubjects(s.id, full.subjects, full.data, settings); return f ? `• تحت علامة النجاح: ${f}` : ""; })(),
      الرابط: s.share_enabled ? absoluteUrl(`/s/?t=${s.share_token}`) : "",
      اسم_الأستاذ: settings.profile.teacher_name,
      اسم_المدرسة: settings.profile.school_name,
    });
  };

  const withPhone = students.filter((s) => phones[s.id]);
  const noPhone = students.filter((s) => !phones[s.id]);

  function go(d: 1 | -1) {
    // الطلاب بدون رقم يُتخطّون
    let i = idx;
    for (let n = 0; n < students.length; n++) {
      i += d;
      if (i < 0 || i >= students.length) return;
      if (phones[students[i].id]) { setIdx(i); setAddPhone(""); return; }
    }
  }
  useEffect(() => {
    // أول طالب له رقم
    if (!full) return;
    const first = students.findIndex((s) => phones[s.id]);
    if (first > 0 && !phones[students[idx]?.id]) setIdx(first);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open() {
    if (!st) return;
    const phone = phones[st.id];
    if (!phone) return;
    const text = edited[st.id] ?? messageFor(st);
    window.open(waLink(phone, text), "_blank", "noopener");
    const p = periodFor(st.id);
    const row = { student_id: st.id, period_from: p.from, period_to: p.to, sent_at: new Date().toISOString() };
    setLogs((l) => [row, ...l]);
    const { error } = await supabase().from("message_log").insert(row);
    if (error) toast({ text: "لم يُسجّل في سجل الرسائل: " + error.message, kind: "err" });
  }

  async function savePhone() {
    if (!st) return;
    const n = normalizePhone(addPhone, W.country_code);
    if (!n) return toast({ text: "الرقم غير صالح", kind: "err" });
    const { error } = await supabase().from("students").update({ phone: n, pending_phone: null }).eq("id", st.id);
    if (error) return toast({ text: error.message, kind: "err" });
    setPhones((m) => ({ ...m, [st.id]: n }));
    setAddPhone("");
    toast({ text: "حُفظ الرقم", kind: "ok" });
  }

  return (
    <Modal open onClose={onClose} title={title ?? (students.length === 1 ? `رسالة واتساب — ${students[0].full_name}` : `رسائل واتساب (${students.length} طالب)`)} wide>
      {!full ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="min-w-0 space-y-3">
            {noPhone.length > 0 && students.length > 1 && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {noPhone.length} بدون رقم سيتم تخطّيهم: {noPhone.slice(0, 6).map((s) => s.full_name).join("، ")}{noPhone.length > 6 ? "…" : ""} · <Link className="underline" href={`/class?id=${classId}&phones=1`}>أضف أرقاماً</Link>
              </p>
            )}
            {st && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{st.full_name}</span>
                  {phones[st.id] ? <span className="text-sm text-zinc-500" dir="ltr">{prettyPhone(phones[st.id], W.country_code)}</span> : <span className="text-sm text-red-600">بدون رقم</span>}
                  {sentToday.has(st.id) && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900/40 dark:text-green-300">أُرسلت اليوم</span>}
                  <span className="ms-auto text-xs text-zinc-500">الفترة: {fmtDate(periodFor(st.id).from)} – {fmtDate(periodFor(st.id).to)}</span>
                </div>
                {!phones[st.id] && (
                  <div className="flex gap-2">
                    <Input dir="ltr" placeholder="03 123 456" value={addPhone} onChange={(e) => setAddPhone(e.target.value)} onKeyDown={(e) => e.key === "Enter" && savePhone()} />
                    <Button variant="secondary" onClick={savePhone}>أضف رقماً</Button>
                  </div>
                )}
                <textarea rows={9} value={edited[st.id] ?? messageFor(st)} onChange={(e) => setEdited((m) => ({ ...m, [st.id]: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 p-3 text-sm leading-7 dark:border-zinc-700 dark:bg-zinc-900" aria-label="نص الرسالة" />
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={open} disabled={!phones[st.id]}>افتح واتساب</Button>
                  {students.length > 1 && <>
                    <Button variant="secondary" onClick={() => go(1)} disabled={idx >= students.length - 1}>التالي ←</Button>
                    <Button variant="ghost" onClick={() => go(-1)} disabled={idx === 0}>→ السابق</Button>
                  </>}
                  {edited[st.id] !== undefined && <Button variant="ghost" size="sm" onClick={() => setEdited((m) => { const n = { ...m }; delete n[st.id]; return n; })}>إرجاع الرسالة الأصلية</Button>}
                  <Info title="كيف يعمل؟">يفتح واتساب على رقم الطالب والرسالة مكتوبة، وأنت تضغط «إرسال» داخل واتساب. الرسالة للطالب فقط. القالب والفترة من الإعدادات ← واتساب.</Info>
                </div>
              </>
            )}
          </div>
          {students.length > 1 && (
            <ol className="max-h-[60vh] space-y-0.5 overflow-y-auto text-sm">
              {students.map((s, i) => (
                <li key={s.id}>
                  <button onClick={() => { setIdx(i); setAddPhone(""); }} className={cx("flex w-full items-center gap-2 rounded px-2 py-1 text-right", i === idx ? "bg-brand-50 font-medium dark:bg-brand-700/30" : "hover:bg-zinc-100 dark:hover:bg-zinc-800", !phones[s.id] && "text-zinc-400")}>
                    <span className="flex-1 truncate">{s.full_name}</span>
                    {sentToday.has(s.id) ? <span className="text-xs text-green-600">✓</span> : !phones[s.id] ? <span className="text-[10px]">بدون رقم</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          )}
          {withPhone.length === 0 && students.length > 1 && <p className="text-sm text-zinc-500">لا يوجد أي طالب له رقم بعد.</p>}
        </div>
      )}
    </Modal>
  );
}

/** شاشة «إدخال الأرقام» لصف: الأسماء بالترتيب وبجانب كل اسم خانة، مثل كشف العلامات. */
export function PhoneEntry({ students, onClose, onSaved }: { students: Student[]; onClose: () => void; onSaved: () => void }) {
  const { settings } = useSettings();
  const toast = useToast();
  const cc = settings.whatsapp.country_code;
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(students.map((s) => [s.id, s.phone ? prettyPhone(s.phone, cc) : ""])));
  const [saved, setSaved] = useState<Record<string, string | null>>(() => Object.fromEntries(students.map((s) => [s.id, s.phone ?? null])));
  const [pending, setPending] = useState<Record<string, string | null>>(() => Object.fromEntries(students.map((s) => [s.id, s.pending_phone ?? null])));
  const [bad, setBad] = useState<Set<string>>(new Set());
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const changed = useRef(false);

  async function commit(s: Student, raw: string) {
    const t = raw.trim();
    const n = t ? normalizePhone(t, cc) : null;
    if (t && !n) { setBad((b) => new Set(b).add(s.id)); return; }
    setBad((b) => { const x = new Set(b); x.delete(s.id); return x; });
    if (n === saved[s.id]) return;
    const { error } = await supabase().from("students").update({ phone: n }).eq("id", s.id);
    if (error) return toast({ text: error.message, kind: "err" });
    changed.current = true;
    setSaved((m) => ({ ...m, [s.id]: n }));
    setVals((m) => ({ ...m, [s.id]: n ? prettyPhone(n, cc) : "" }));
  }

  async function decide(s: Student, ok: boolean) {
    const p = pending[s.id];
    const patch = ok ? { phone: p, pending_phone: null } : { pending_phone: null };
    const { error } = await supabase().from("students").update(patch).eq("id", s.id);
    if (error) return toast({ text: error.message, kind: "err" });
    changed.current = true;
    setPending((m) => ({ ...m, [s.id]: null }));
    if (ok) { setSaved((m) => ({ ...m, [s.id]: p })); setVals((m) => ({ ...m, [s.id]: prettyPhone(p, cc) })); }
  }

  function onPaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    const lines = text.split(/\r?\n/).map((x) => x.trim()).filter((x, k, a) => x || k < a.length - 1);
    if (lines.length < 2) return; // لصق عادي
    e.preventDefault();
    lines.forEach((line, k) => {
      const s = students[i + k];
      if (!s) return;
      setVals((m) => ({ ...m, [s.id]: line }));
      commit(s, line);
    });
    toast({ text: `لُصق ${Math.min(lines.length, students.length - i)} رقم`, kind: "ok" });
  }

  function close() { if (changed.current) onSaved(); onClose(); }
  const filled = Object.values(saved).filter(Boolean).length;

  return (
    <Modal open onClose={close} title="إدخال أرقام الطلاب" wide>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
        اكتب الرقم بأي شكل (مثلاً 03 123 456) واضغط Enter للانتقال للطالب التالي. يمكن لصق عمود أرقام دفعة واحدة في أي خانة.
        مفتاح الدولة الافتراضي {cc} (الإعدادات ← واتساب). <b>{filled}</b> من {students.length} لهم رقم.
      </p>
      <div className="table-scroll rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="sheet w-full text-sm">
          <thead><tr><th className="sticky-c1">#</th><th className="sticky-c2 text-right">الاسم</th><th className="min-w-[12rem]">رقم الطالب</th><th>رقم أرسله الطالب<Info title="رقم أرسله الطالب">من صفحة علاماته ← «أرسل رقمك». يحتاج موافقتك قبل استعماله.</Info></th></tr></thead>
          <tbody>
            {students.map((s, i) => (
              <tr key={s.id}>
                <td className="sticky-c1 text-center text-zinc-400">{i + 1}</td>
                <td className="sticky-c2 whitespace-nowrap px-2">{s.full_name}</td>
                <td className="p-0">
                  <input ref={(el) => { refs.current[i] = el; }} dir="ltr" inputMode="tel" aria-label={`رقم ${s.full_name}`}
                    className={cx("grid-cell", bad.has(s.id) && "bg-red-50 text-red-700 dark:bg-red-950/40")}
                    value={vals[s.id] ?? ""} placeholder="03 123 456"
                    onChange={(e) => setVals((m) => ({ ...m, [s.id]: e.target.value }))}
                    onBlur={(e) => commit(s, e.target.value)}
                    onPaste={(e) => onPaste(i, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); refs.current[i + 1]?.focus(); refs.current[i + 1]?.select(); }
                      if (e.key === "ArrowUp") { e.preventDefault(); refs.current[i - 1]?.focus(); }
                    }} />
                </td>
                <td className="px-2 text-center">
                  {pending[s.id] ? (
                    <span className="inline-flex items-center gap-1">
                      <span dir="ltr" className="tabular-nums">{prettyPhone(pending[s.id], cc)}</span>
                      <Button size="sm" variant="secondary" onClick={() => decide(s, true)}>قبول</Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(s, false)}>رفض</Button>
                    </span>
                  ) : <span className="text-zinc-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bad.size > 0 && <p className="mt-2 text-xs text-red-600">{bad.size} رقم غير صالح (بالأحمر) لم يُحفظ.</p>}
      <div className="mt-3 flex justify-end"><Button onClick={close}>تمّ</Button></div>
    </Modal>
  );
}
