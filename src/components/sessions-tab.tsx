"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { datesBetween, fmtDate, semesterFor, toISO, today, weekdayOf } from "@/lib/dates";
import { exportXlsx } from "@/lib/excel";
import { WEEKDAYS, type Session, type SessionRecord, type Slot, type Student, type Subject } from "@/lib/types";
import { useSettings } from "./settings-provider";
import { Button, Card, Empty, Field, Input, Modal, Select, Spinner, cx, useToast } from "./ui";

export function SessionsTab({ subject, students }: { subject: Subject; students: Student[] }) {
  const { settings } = useSettings();
  const toast = useToast();
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [sessions, setSessions] = useState<(Session & { session_records: { count: number }[] })[] | null>(null);
  const [slotEdit, setSlotEdit] = useState<Partial<Slot> | null>(null);
  const [extra, setExtra] = useState<string | null>(null);
  const [gen, setGen] = useState<{ sem: 1 | 2; from: string; to: string } | null>(null);
  const [sem, setSem] = useState<0 | 1 | 2>(0);

  const load = useCallback(async () => {
    const sb = supabase();
    const [a, b] = await Promise.all([
      sb.from("schedule_slots").select("*").eq("subject_id", subject.id).order("weekday"),
      sb.from("sessions").select("*, session_records(count)").eq("subject_id", subject.id).is("deleted_at", null).order("date", { ascending: false }),
    ]);
    setSlots((a.data ?? []) as Slot[]);
    setSessions((b.data ?? []) as never);
  }, [subject.id]);
  useEffect(() => { load(); }, [load]);

  async function saveSlot(e: React.FormEvent) {
    e.preventDefault();
    const p = { weekday: Number(slotEdit?.weekday ?? 1), start_time: slotEdit?.start_time || null, end_time: slotEdit?.end_time || null };
    const { error } = slotEdit?.id
      ? await supabase().from("schedule_slots").update(p).eq("id", slotEdit.id)
      : await supabase().from("schedule_slots").insert({ ...p, subject_id: subject.id });
    if (error) return toast({ text: error.message, kind: "err" });
    setSlotEdit(null);
    load();
  }
  async function delSlot(s: Slot) {
    await supabase().from("schedule_slots").delete().eq("id", s.id);
    load();
  }

  async function generate() {
    if (!gen) return;
    const existing = new Set((sessions ?? []).map((s) => s.date + (s.schedule_slot_id ?? "")));
    const rows: Partial<Session>[] = [];
    for (const sl of slots) {
      for (const d of datesBetween(gen.from, gen.to, [sl.weekday], settings)) {
        if (!existing.has(d + sl.id)) rows.push({ subject_id: subject.id, schedule_slot_id: sl.id, date: d, semester: gen.sem });
      }
    }
    if (!rows.length) { toast({ text: "لا توجد حصص جديدة لإنشائها", kind: "ok" }); setGen(null); return; }
    const { error } = await supabase().from("sessions").insert(rows);
    if (error) return toast({ text: error.message, kind: "err" });
    toast({ text: `أُنشئت ${rows.length} حصة`, kind: "ok" });
    setGen(null);
    load();
  }

  async function addExtra(e: React.FormEvent) {
    e.preventDefault();
    if (!extra) return;
    const { data, error } = await supabase().from("sessions")
      .insert({ subject_id: subject.id, date: extra, semester: semesterFor(extra, settings) }).select("id").single();
    if (error) return toast({ text: error.message, kind: "err" });
    router.push(`/session?id=${data.id}`);
  }

  async function toggleCancel(s: Session) {
    await supabase().from("sessions").update({ cancelled: !s.cancelled }).eq("id", s.id);
    load();
  }
  async function remove(s: Session) {
    await supabase().from("sessions").update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    toast({ text: "حُذفت الحصة", kind: "ok", action: { label: "تراجع", run: async () => { await supabase().from("sessions").update({ deleted_at: null }).eq("id", s.id); load(); } } });
    load();
  }

  async function exportLogs() {
    const list = (sessions ?? []).filter((s) => !s.cancelled && (!sem || s.semester === sem)).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return;
    const { data } = await supabase().from("session_records").select("*").in("session_id", list.map((s) => s.id));
    const recs = (data ?? []) as SessionRecord[];
    const L = settings.labels;
    const byId = new Map(students.map((s) => [s.id, s.full_name]));
    const dateOf = new Map(list.map((s) => [s.id, s.date]));
    const rows = recs
      .sort((a, b) => (dateOf.get(a.session_id) ?? "").localeCompare(dateOf.get(b.session_id) ?? ""))
      .map((r) => [
        fmtDate(dateOf.get(r.session_id) ?? ""), byId.get(r.student_id) ?? "",
        r.participation, r.disruption, r.late ? "✓" : "",
        r.absence === "excused" ? L.excused : r.absence === "unexcused" ? L.unexcused : "",
        r.homework === "done" ? L.hw_done : r.homework === "missing" ? L.hw_missing : "", r.note ?? "",
      ]);
    // ملخص لكل طالب
    const sum = students.map((st, i) => {
      const mine = recs.filter((r) => r.student_id === st.id);
      return [i + 1, st.full_name,
        mine.reduce((a, r) => a + r.participation, 0), mine.reduce((a, r) => a + r.disruption, 0),
        mine.filter((r) => r.late).length, mine.filter((r) => r.absence === "unexcused").length,
        mine.filter((r) => r.absence === "excused").length, mine.filter((r) => r.homework === "done").length,
        mine.filter((r) => r.homework === "missing").length];
    });
    await exportXlsx([
      { name: "ملخص", title: `${subject.name} — ملخص السلوك والحضور`, header: ["#", "الاسم", L.participation, L.disruption, L.late, `${L.absent} ${L.unexcused}`, `${L.absent} ${L.excused}`, L.hw_done, L.hw_missing], rows: sum },
      { name: "سجل الحصص", header: ["التاريخ", "الاسم", L.participation, L.disruption, L.late, L.absent, L.homework, L.note], rows, widths: [12, 30, 10, 10, 10, 12, 12, 30] },
    ], `سجل حصص ${subject.name}.xlsx`);
  }

  if (!sessions) return <Spinner />;
  const t = today();
  const shown = sessions.filter((s) => !sem || s.semester === sem);
  const todays = sessions.filter((s) => s.date === t && !s.cancelled);

  return (
    <div className="space-y-6">
      {todays.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-brand-500 bg-brand-50 dark:bg-brand-700/20">
          <span className="font-semibold">حصة اليوم</span>
          {todays.map((s) => <Link key={s.id} href={`/session?id=${s.id}`}><Button size="sm">تسجيل الحصة ←</Button></Link>)}
        </Card>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">البرنامج الأسبوعي <span className="text-sm font-normal text-zinc-500">({slots.length} حصة في الأسبوع)</span></h3>
          <Button size="sm" variant="secondary" onClick={() => setSlotEdit({ weekday: 1 })}>+ موعد</Button>
        </div>
        {slots.length === 0 ? <Empty>أضف مواعيد الحصص الأسبوعية (مثلاً: الإثنين 8:00) ليتم إنشاء الحصص تلقائياً.</Empty> : (
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <b>{WEEKDAYS[s.weekday]}</b>
                {s.start_time && <span className="text-zinc-500" dir="ltr">{s.start_time.slice(0, 5)}{s.end_time && `–${s.end_time.slice(0, 5)}`}</span>}
                <button className="text-zinc-400 hover:text-zinc-700" onClick={() => setSlotEdit(s)} aria-label="تعديل">✎</button>
                <button className="text-zinc-400 hover:text-red-600" onClick={() => delSlot(s)} aria-label="حذف">✕</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">الحصص</h3>
          <Select value={sem} onChange={(e) => setSem(Number(e.target.value) as 0 | 1 | 2)}>
            <option value={0}>كل السنة</option><option value={1}>{settings.labels.term1}</option><option value={2}>{settings.labels.term2}</option>
          </Select>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={exportLogs}>تصدير السجل</Button>
          <Button size="sm" variant="secondary" onClick={() => setExtra(t)}>+ حصة إضافية</Button>
          <Button size="sm" disabled={!slots.length} onClick={() => setGen({ sem: 1, from: settings.year.start, to: settings.year.sem1_end })}>توليد الحصص</Button>
        </div>
        {shown.length === 0 ? <Empty>لا توجد حصص. استعمل «توليد الحصص» أو أضف حصة.</Empty> : (
          <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
            {shown.map((s) => (
              <div key={s.id} className={cx("flex items-center gap-3 px-4 py-2.5", s.cancelled && "opacity-50", s.date === t && "bg-brand-50/50 dark:bg-brand-700/10")}>
                <Link href={`/session?id=${s.id}`} className="flex flex-1 items-center gap-3 hover:text-brand-600">
                  <span className="w-20 text-sm font-medium tabular-nums">{fmtDate(s.date)}</span>
                  <span className="w-16 text-sm text-zinc-500">{WEEKDAYS[weekdayOf(s.date)]}</span>
                  <span className="text-xs text-zinc-500">{s.semester === 1 ? settings.labels.term1 : settings.labels.term2}</span>
                  {s.topic && <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">{s.topic}</span>}
                  {s.cancelled ? <span className="text-xs text-red-600">ملغاة</span>
                    : s.session_records?.[0]?.count ? <span className="text-xs text-green-600">✓ مسجلة</span>
                    : s.date <= t ? <span className="text-xs text-amber-600">غير مسجلة</span> : null}
                </Link>
                <Button size="sm" variant="ghost" onClick={() => toggleCancel(s)}>{s.cancelled ? "إعادة" : "إلغاء"}</Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(s)}>حذف</Button>
              </div>
            ))}
          </Card>
        )}
      </section>

      <Modal open={!!slotEdit} onClose={() => setSlotEdit(null)} title="موعد أسبوعي">
        <form onSubmit={saveSlot} className="space-y-3">
          <Field label="اليوم">
            <Select className="w-full" value={slotEdit?.weekday ?? 1} onChange={(e) => setSlotEdit({ ...slotEdit, weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="من"><Input type="time" value={slotEdit?.start_time?.slice(0, 5) ?? ""} onChange={(e) => setSlotEdit({ ...slotEdit, start_time: e.target.value })} /></Field>
            <Field label="إلى"><Input type="time" value={slotEdit?.end_time?.slice(0, 5) ?? ""} onChange={(e) => setSlotEdit({ ...slotEdit, end_time: e.target.value })} /></Field>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setSlotEdit(null)}>إلغاء</Button><Button>حفظ</Button></div>
        </form>
      </Modal>

      <Modal open={!!gen} onClose={() => setGen(null)} title="توليد الحصص من البرنامج">
        {gen && (
          <div className="space-y-3">
            <Field label="النصف">
              <Select className="w-full" value={gen.sem} onChange={(e) => {
                const s = Number(e.target.value) as 1 | 2;
                const [yy, mm, dd] = settings.year.sem1_end.split("-").map(Number);
                const d = new Date(yy, mm - 1, dd + 1);
                setGen(s === 1 ? { sem: 1, from: settings.year.start, to: settings.year.sem1_end } : { sem: 2, from: toISO(d), to: settings.year.end });
              }}>
                <option value={1}>{settings.labels.term1}</option><option value={2}>{settings.labels.term2}</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="من"><Input type="date" value={gen.from} onChange={(e) => setGen({ ...gen, from: e.target.value })} /></Field>
              <Field label="إلى"><Input type="date" value={gen.to} onChange={(e) => setGen({ ...gen, to: e.target.value })} /></Field>
            </div>
            <p className="text-xs text-zinc-500">تُستثنى أيام العطلة الأسبوعية والعطل المحددة في الإعدادات، ولا تتكرر الحصص الموجودة.</p>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setGen(null)}>إلغاء</Button><Button onClick={generate}>توليد</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={extra !== null} onClose={() => setExtra(null)} title="حصة إضافية">
        <form onSubmit={addExtra} className="space-y-3">
          <Field label="التاريخ"><Input type="date" required value={extra ?? ""} onChange={(e) => setExtra(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setExtra(null)}>إلغاء</Button><Button>إنشاء وفتح</Button></div>
        </form>
      </Modal>
    </div>
  );
}
