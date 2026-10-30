"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/class-data";
import { fmtDate, toISO } from "@/lib/dates";
import { enqueue } from "@/lib/outbox";
import { isOnline } from "@/lib/offline-fetch";
import { addDays, buildWeek, minutes, rowKeyOf, STATUS_LABEL, weekDays, weekProgress, weekStartFor, type Instance } from "@/lib/schedule";
import { ensureSession, loadWeek, prefetchSessions } from "@/lib/session-data";
import { WEEKDAYS, type SessionRecord, type Student } from "@/lib/types";
import { useSettings } from "./settings-provider";
import { AlertsStrip } from "./alerts";
import { Info } from "./info";
import { WhatsAppQueue } from "./whatsapp";
import { Button, Card, Empty, Input, LoadError, Modal, Spinner, cx } from "./ui";
import { logError } from "@/lib/errors";

type Week = Awaited<ReturnType<typeof loadWeek>>;
const SHORT = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const dm = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(d)}/${Number(m)}`; };

/** البرنامج الأسبوعي: الصفحة الرئيسية. أيام × ساعات، وكل حصة تُظهر إذا كانت مسجلة. */
export function WeekSchedule() {
  const { settings, loaded } = useSettings();
  const router = useRouter();
  const q = useSearchParams();
  const [offset, setOffset] = useState(() => Number(q.get("w") ?? 0) || 0);
  const [now, setNow] = useState(() => new Date());
  const [week, setWeek] = useState<Week | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [card, setCard] = useState<Instance | null>(null);
  const [panel, setPanel] = useState<Instance | null>(null);
  const [missingOpen, setMissingOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const autoOpened = useRef(false);
  // اختصار «حصة اليوم» (?now=1): نحفظه قبل أن يُعاد كتابة الرابط
  const wantNow = useRef(q.get("now") === "1");

  const todayISO = toISO(now);
  const start = useMemo(() => addDays(weekStartFor(todayISO, settings.year.weekend_days), offset * 7), [todayISO, settings.year.weekend_days, offset]);
  const end = addDays(start, 6);
  const days = useMemo(() => weekDays(start, settings, todayISO), [start, settings, todayISO]);

  const [err, setErr] = useState(false);
  const reload = useCallback(async () => {
    try {
      setErr(false);
      setWeek(await loadWeek(start, end));
    } catch (e) { logError(e); setErr(true); }
  }, [start, end]);
  useEffect(() => { if (loaded) { setWeek(null); reload(); } }, [loaded, reload]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const url = offset ? `?w=${offset}` : "";
    window.history.replaceState(null, "", window.location.pathname + url);
  }, [offset]);

  const built = useMemo(() => week ? buildWeek({ days, slots: week.slots, sessions: week.sessions, summaries: week.summaries, settings, now }) : null, [week, days, settings, now]);
  const progress = built ? weekProgress(built.instances) : null;

  // تحميل مسبق لحصص هذا الأسبوع حتى تفتح بدون إنترنت
  useEffect(() => {
    if (!built || offset !== 0 || !isOnline()) return;
    const key = `prefetched:${start}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch {}
    const t = setTimeout(() => prefetchSessions(built.instances.map((i) => i.id), built.instances.map((i) => i.subject.id)), 1500);
    return () => clearTimeout(t);
  }, [built, offset, start]);

  // يوم التلفون: اليوم إن كان في هذا الأسبوع، وإلا أول يوم
  useEffect(() => {
    if (!days.length) return;
    setDay((d) => (d && days.some((x) => x.date === d) ? d : days.find((x) => x.isToday)?.date ?? days[0].date));
  }, [days]);

  const open = useCallback((i: Instance) => {
    if (i.status === "cancelled" || i.date > todayISO) { setCard(i); return; }
    if (!i.real) ensureSession({ id: i.id, subject_id: i.subject.id, schedule_slot_id: i.slot?.id ?? null, date: i.date, semester: i.semester });
    router.push(`/session?id=${i.id}`);
  }, [router, todayISO]);

  // اختصار «حصة اليوم»: يفتح الحصة الجارية مباشرة
  useEffect(() => {
    if (!built || autoOpened.current || !wantNow.current) return;
    autoOpened.current = true;
    const cur = built.instances.find((i) => i.current && i.status !== "cancelled") ?? built.instances.find((i) => i.date === todayISO && (i.status === "now" || i.status === "today"));
    if (cur) open(cur);
  }, [built, todayISO, open]);

  if (err && !week) return <LoadError onRetry={reload} />;
  if (!loaded || !week || !built) return <Spinner />;
  const { rows, instances } = built;
  const untimed = instances.some((i) => !i.start);
  const at = (date: string, rk: string) => instances.filter((i) => i.date === date && rowKeyOf(i) === rk);

  return (
    <div>
      <AlertsStrip />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="flex items-center text-2xl font-bold">البرنامج الأسبوعي<Info title="البرنامج الأسبوعي">كل حصص الأسبوع من مواعيد المواد. الأخضر = مسجّلة، البرتقالي = مضى وقتها بدون تسجيل، الإطار = الحصة الجارية الآن. اضغط على حصة لفتح تسجيلها مباشرة. أيقونة 📊 (أو ضغطة مطوّلة على التلفون) تفتح إحصائيات الحصة.</Info></h1>
        <span className="text-sm text-zinc-500">{dm(start)} – {dm(days[days.length - 1]?.date ?? end)}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 text-sm">
          <Button size="sm" variant="secondary" onClick={() => setOffset((o) => o - 1)}>→ الأسبوع السابق</Button>
          <Button size="sm" variant={offset === 0 ? "primary" : "secondary"} onClick={() => setOffset(0)}>هذا الأسبوع</Button>
          <Button size="sm" variant="secondary" onClick={() => setOffset((o) => o + 1)}>الأسبوع التالي ←</Button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>تعديل البرنامج</Button>
      </div>

      {progress && progress.due > 0 && (
        <div className={cx("mb-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm",
          progress.missing.length ? "bg-orange-50 text-orange-900 dark:bg-orange-950/30 dark:text-orange-200" : "bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-200")}>
          <span>سُجّلت <b>{progress.logged}</b> من <b>{progress.due}</b> حصة {offset === 0 ? "هذا الأسبوع" : "في هذا الأسبوع"}</span>
          {progress.missing.length > 0 && <button className="font-medium underline" onClick={() => setMissingOpen(true)}>{progress.missing.length} غير مسجّلة ←</button>}
        </div>
      )}

      {week.slots.length === 0 && week.sessions.length === 0 ? (
        <Empty>
          لا توجد مواعيد حصص بعد. افتح أي مادة ← الحصص ← «+ موعد» (مثلاً الإثنين 8:00–8:50) لتظهر في البرنامج.
          <div className="mt-3"><Link href="/classes"><Button size="sm">الذهاب إلى الصفوف</Button></Link></div>
        </Empty>
      ) : (
        <>
          {/* الكمبيوتر: جدول الأسبوع كاملاً */}
          <Card className="hidden overflow-x-auto p-0 lg:block">
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="w-24 border-b border-zinc-200 p-2 text-xs font-medium text-zinc-500 dark:border-zinc-800">الوقت</th>
                  {days.map((d) => (
                    <th key={d.date} className={cx("border-b border-s border-zinc-200 p-2 dark:border-zinc-800", d.isToday && "bg-brand-500 text-white", d.holiday && "bg-zinc-100 text-zinc-400 dark:bg-zinc-800")}>
                      <div className="font-semibold">{d.isToday ? "اليوم" : WEEKDAYS[d.weekday]}</div>
                      <div className={cx("text-xs font-normal", d.isToday ? "text-white/80" : "text-zinc-500")}>{d.isToday ? `${WEEKDAYS[d.weekday]} ` : ""}{fmtDate(d.date)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="border-b border-zinc-100 p-2 text-center align-top text-xs tabular-nums text-zinc-500 dark:border-zinc-800" dir="ltr">{r.start}{r.end && `–${r.end}`}</td>
                    {days.map((d) => (
                      <td key={d.date} className={cx("relative border-b border-s border-zinc-100 p-1.5 align-top dark:border-zinc-800", d.isToday && "bg-brand-50/60 dark:bg-brand-700/10", d.holiday && "bg-zinc-100 dark:bg-zinc-800/60")}>
                        {d.isToday && <NowLine row={r} rows={rows} now={now} />}
                        <div className="space-y-1.5">
                          {at(d.date, r.key).map((i) => <Cell key={i.id} i={i} onOpen={open} onStats={setPanel} />)}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
                {(untimed || days.some((d) => d.holiday)) && (
                  <tr>
                    <td className="p-2 text-center align-top text-xs text-zinc-500">بدون وقت</td>
                    {days.map((d) => (
                      <td key={d.date} className={cx("border-s border-zinc-100 p-1.5 align-top dark:border-zinc-800", d.isToday && "bg-brand-50/60 dark:bg-brand-700/10", d.holiday && "bg-zinc-100 dark:bg-zinc-800/60")}>
                        {d.holiday && <div className="mb-1 text-center text-xs font-medium text-zinc-500">{d.holiday}</div>}
                        <div className="space-y-1.5">{at(d.date, "none").map((i) => <Cell key={i.id} i={i} onOpen={open} onStats={setPanel} />)}</div>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          {/* التلفون: يوم واحد بالطول مع شريط الأيام */}
          <div className="lg:hidden">
            <DayTabs days={days} day={day} setDay={setDay} instances={instances} />
            {day && <DayList date={day} days={days} setDay={setDay} instances={instances.filter((i) => i.date === day)} holiday={days.find((d) => d.date === day)?.holiday ?? null} onOpen={open} onStats={setPanel} />}
          </div>
        </>
      )}

      {card && <InstanceCard i={card} onClose={() => setCard(null)} onChanged={() => { setCard(null); reload(); }} />}
      {panel && week && <StatsPanel i={panel} records={week.records.filter((r) => r.session_id === panel.id)} onClose={() => setPanel(null)} onOpen={() => open(panel)} />}
      <Modal open={missingOpen} onClose={() => setMissingOpen(false)} title="حصص غير مسجّلة">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {progress?.missing.map((i) => (
            <li key={i.id}>
              <button className="flex w-full items-center gap-2 py-2 text-right text-sm hover:text-brand-600" onClick={() => { setMissingOpen(false); open(i); }}>
                <span className="h-4 w-1 rounded" style={{ background: i.subject.color }} />
                <span className="flex-1">{i.subject.name} · {i.subject.class_name}</span>
                <span className="text-xs text-zinc-500">{WEEKDAYS[days.find((d) => d.date === i.date)?.weekday ?? 0]} {fmtDate(i.date)} {i.start}</span>
                <span className="text-brand-600">سجّل ←</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
      {editOpen && <EditSchedule onClose={() => setEditOpen(false)} />}
    </div>
  );
}

/** خط أفقي رفيع يبيّن الساعة الحالية في عمود اليوم. */
function NowLine({ row, rows, now }: { row: { start: string | null; end: string | null }; rows: { start: string | null; end: string | null }[]; now: Date }) {
  const m = now.getHours() * 60 + now.getMinutes();
  const s = minutes(row.start), e = minutes(row.end) ?? (s !== null ? s + 50 : null);
  if (s === null || e === null) return null;
  let top: number | null = null;
  // إذا تداخلت أوقات حصتين، يُرسم الخط مرة واحدة في الحصة التي بدأت أخيراً
  const containing = rows.filter((r) => { const a = minutes(r.start), z = minutes(r.end) ?? (a !== null ? a + 50 : null); return a !== null && z !== null && m >= a && m <= z; });
  const owner = containing[containing.length - 1];
  if (owner && (owner.start !== row.start || owner.end !== row.end)) return null;
  if (m >= s && m <= e) top = ((m - s) / Math.max(1, e - s)) * 100;
  else {
    const idx = rows.findIndex((r) => r.start === row.start && r.end === row.end);
    const next = rows[idx + 1];
    const ns = minutes(next?.start ?? null);
    if (!containing.length && m > e && (ns === null ? idx === rows.length - 1 && m <= e + 60 : m < ns)) top = 100;
  }
  if (top === null) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: `${top}%` }} aria-hidden>
      <div className="relative h-0.5 bg-red-500"><span className="absolute -top-1 start-0 h-2.5 w-2.5 rounded-full bg-red-500" /></div>
    </div>
  );
}

const TONE: Record<Instance["status"], string> = {
  logged: "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40",
  locked: "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40",
  missed: "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40",
  now: "border-brand-500 bg-white ring-2 ring-brand-500 dark:bg-zinc-900",
  today: "border-brand-300 bg-white dark:border-brand-700 dark:bg-zinc-900",
  upcoming: "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50",
  cancelled: "border-zinc-200 bg-zinc-50 text-zinc-400 line-through opacity-70 dark:border-zinc-800 dark:bg-zinc-900/50",
};
const STATUS_TEXT: Record<Instance["status"], string> = {
  logged: "text-green-700 dark:text-green-400", locked: "text-green-700 dark:text-green-400", missed: "text-orange-700 dark:text-orange-400",
  now: "text-brand-600 dark:text-brand-100", today: "text-brand-600 dark:text-brand-100", upcoming: "text-zinc-500", cancelled: "text-zinc-400",
};
const ICON: Partial<Record<Instance["status"], string>> = { logged: "✓", locked: "🔒", missed: "!" };

function mini(i: Instance) {
  const s = i.summary;
  if (!s || !s.records) return null;
  const parts = [];
  if (s.absent + s.excused) parts.push(`غائب ${s.absent + s.excused}`);
  if (s.late) parts.push(`متأخر ${s.late}`);
  parts.push(`مشاركة ${s.participation}`);
  if (s.disruption) parts.push(`شغب ${s.disruption}`);
  return parts.join(" · ");
}

function useLongPress(fn: () => void) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  return {
    onTouchStart: () => { fired.current = false; t.current = setTimeout(() => { fired.current = true; fn(); }, 550); },
    onTouchEnd: () => { if (t.current) clearTimeout(t.current); },
    onTouchMove: () => { if (t.current) clearTimeout(t.current); },
    fired,
  };
}

/** حصة واحدة داخل خانة الجدول. */
function Cell({ i, onOpen, onStats, big }: { i: Instance; onOpen: (i: Instance) => void; onStats: (i: Instance) => void; big?: boolean }) {
  const logged = i.status === "logged" || i.status === "locked";
  const lp = useLongPress(() => logged && onStats(i));
  return (
    <div className={cx("group relative rounded-lg border border-s-4 p-2 text-start transition hover:shadow-sm", TONE[i.status], big && "p-3")} style={{ borderInlineStartColor: i.subject.color }}>
      <button className="block w-full text-start" onClick={() => { if (!lp.fired.current) onOpen(i); }}
        onTouchStart={lp.onTouchStart} onTouchEnd={lp.onTouchEnd} onTouchMove={lp.onTouchMove} onContextMenu={(e) => { if (logged) e.preventDefault(); }}
        aria-label={`${i.subject.name} ${i.subject.class_name} — ${STATUS_LABEL[i.status]}`}>
        <div className="flex items-start gap-1">
          <span className={cx("min-w-0 flex-1 truncate font-semibold", i.status === "cancelled" && "line-through")}>{i.subject.name}</span>
          {i.current && i.status !== "cancelled" && <span className="shrink-0 rounded bg-brand-500 px-1.5 text-[10px] font-bold leading-5 text-white">الآن</span>}
          {i.next && <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[10px] font-bold leading-5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">التالية</span>}
        </div>
        <div className="truncate text-xs text-zinc-500">{i.subject.class_name}{big && i.start ? ` · ${i.start}${i.end ? `–${i.end}` : ""}` : ""}</div>
        <div className={cx("mt-1 flex items-center gap-1 text-xs font-medium", STATUS_TEXT[i.status])}>
          {ICON[i.status] && <span aria-hidden>{ICON[i.status]}</span>}
          <span>{STATUS_LABEL[i.status]}</span>
        </div>
        {logged && <div className="mt-0.5 truncate text-[11px] text-zinc-600 dark:text-zinc-400">{mini(i)}</div>}
        {i.session?.topic && <div className="mt-0.5 truncate text-[11px] text-zinc-500">{i.session.topic}</div>}
      </button>
      {(i.status === "now" || i.status === "today") && <Button size="sm" className="mt-1.5 w-full" onClick={() => onOpen(i)}>سجّل</Button>}
      {logged && (
        <button onClick={() => onStats(i)} className="absolute end-1 bottom-1 rounded p-0.5 text-xs opacity-60 hover:bg-white hover:opacity-100 dark:hover:bg-zinc-800" aria-label="إحصائيات الحصة" title="إحصائيات الحصة">📊</button>
      )}
    </div>
  );
}

function DayTabs({ days, day, setDay, instances }: { days: ReturnType<typeof weekDays>; day: string | null; setDay: (d: string) => void; instances: Instance[] }) {
  return (
    <div className="sticky top-12 z-30 -mx-4 mb-3 flex gap-1 overflow-x-auto border-b border-zinc-200 bg-zinc-50/95 px-4 py-2 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      {days.map((d) => {
        const missed = instances.some((i) => i.date === d.date && i.status === "missed");
        return (
          <button key={d.date} onClick={() => setDay(d.date)}
            className={cx("relative flex min-w-[3.5rem] flex-col items-center rounded-lg px-2 py-1 text-xs",
              day === d.date ? "bg-brand-500 text-white" : d.isToday ? "bg-brand-50 text-brand-700 dark:bg-brand-700/30 dark:text-brand-100" : "bg-white dark:bg-zinc-900", d.holiday && day !== d.date && "text-zinc-400")}>
            <span className="font-semibold">{d.isToday ? "اليوم" : SHORT[d.weekday]}</span>
            <span className="tabular-nums opacity-80">{dm(d.date)}</span>
            {missed && <span className="absolute top-1 end-1 h-1.5 w-1.5 rounded-full bg-orange-500" aria-label="فيه حصص غير مسجّلة" />}
          </button>
        );
      })}
    </div>
  );
}

function DayList({ date, days, setDay, instances, holiday, onOpen, onStats }: {
  date: string; days: ReturnType<typeof weekDays>; setDay: (d: string) => void; instances: Instance[]; holiday: string | null;
  onOpen: (i: Instance) => void; onStats: (i: Instance) => void;
}) {
  const x0 = useRef<number | null>(null);
  const idx = days.findIndex((d) => d.date === date);
  // الحصة الجارية أولاً بدون تمرير، ثم باقي الحصص بالترتيب
  const cur = instances.find((i) => i.current && i.status !== "cancelled");
  const rest = instances.filter((i) => i !== cur);
  return (
    <div className="min-h-[50vh]"
      onTouchStart={(e) => { x0.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (x0.current === null) return;
        const dx = e.changedTouches[0].clientX - x0.current;
        x0.current = null;
        // من اليمين إلى اليسار: سحب إلى اليمين = اليوم التالي
        if (dx > 60 && days[idx + 1]) setDay(days[idx + 1].date);
        if (dx < -60 && days[idx - 1]) setDay(days[idx - 1].date);
      }}>
      {holiday && <p className="mb-3 rounded-lg bg-zinc-100 p-3 text-center text-sm text-zinc-500 dark:bg-zinc-800">عطلة: {holiday}</p>}
      {cur && <div className="mb-3"><Cell i={cur} onOpen={onOpen} onStats={onStats} big /></div>}
      {rest.length === 0 && !cur ? <Empty>{holiday ? "لا حصص في هذا اليوم." : "لا حصص في هذا اليوم."}</Empty> : (
        <div className="space-y-2">
          {rest.map((i) => (
            <div key={i.id} className="flex gap-2">
              <div className="w-12 shrink-0 pt-2 text-center text-xs tabular-nums text-zinc-500" dir="ltr">{i.start ?? "—"}</div>
              <div className="min-w-0 flex-1"><Cell i={i} onOpen={onOpen} onStats={onStats} big /></div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-center text-xs text-zinc-400">اسحب يميناً أو يساراً للتنقل بين الأيام</p>
    </div>
  );
}

/** بطاقة حصة قادمة أو ملغاة: المعلومات، الموضوع المخطط، وإلغاء/إعادة الحصة. */
function InstanceCard({ i, onClose, onChanged }: { i: Instance; onClose: () => void; onChanged: () => void }) {
  const [topic, setTopic] = useState(i.session?.topic ?? "");
  const ensure = () => { if (!i.real) ensureSession({ id: i.id, subject_id: i.subject.id, schedule_slot_id: i.slot?.id ?? null, date: i.date, semester: i.semester }); };
  const set = (p: Record<string, unknown>) => { ensure(); enqueue("sessions", { id: i.id, ...p }, "update"); onChanged(); };
  const wd = WEEKDAYS[new Date(i.date + "T12:00:00").getDay()];
  return (
    <Modal open onClose={onClose} title={`${i.subject.name} — ${i.subject.class_name}`}>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-zinc-600 dark:text-zinc-300">
          <span>{wd} {fmtDate(i.date)}</span>
          {i.start && <span dir="ltr">{i.start}{i.end && `–${i.end}`}</span>}
          <span className={STATUS_TEXT[i.status]}>{STATUS_LABEL[i.status]}</span>
        </div>
        {i.status === "cancelled" ? (
          <p className="text-zinc-500">هذه الحصة ملغاة ولا تدخل في الحساب.</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-sm font-medium">الموضوع المخطط</span>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="مثلاً: الدرس 4 — المعادلات" />
            </label>
            <p className="text-xs text-zinc-500">لا يمكن تسجيل الحصة قبل يومها.</p>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {i.status === "cancelled" ? (
            <Button onClick={() => set({ cancelled: false })}>إعادة الحصة</Button>
          ) : (
            <>
              <Button variant="ghost" className="text-red-600" onClick={() => set({ cancelled: true })}>إلغاء الحصة</Button>
              <Button disabled={topic === (i.session?.topic ?? "")} onClick={() => set({ topic: topic.trim() || null })}>حفظ الموضوع</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** لوحة جانبية بإحصائيات حصة دون مغادرة الجدول. */
function StatsPanel({ i, records, onClose, onOpen }: { i: Instance; records: SessionRecord[]; onClose: () => void; onOpen: () => void }) {
  const { settings } = useSettings();
  const L = settings.labels;
  const [students, setStudents] = useState<Student[] | null>(null);
  const [avg, setAvg] = useState<{ absent: number; participation: number; disruption: number; n: number } | null>(null);
  const [wa, setWa] = useState<Student[] | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const { data } = await sb.from("students").select("*").eq("class_id", i.subject.class_id).is("deleted_at", null).eq("active", true).order("sort_order").order("full_name");
      setStudents((data ?? []) as Student[]);
      // معدل حصص هذه المادة (للمقارنة)
      const rows = await fetchAll((f, t) => sb.from("session_records").select("session_id,absence,participation,disruption,sessions!inner(subject_id,cancelled,deleted_at)")
        .eq("sessions.subject_id", i.subject.id).eq("sessions.cancelled", false).is("sessions.deleted_at", null).range(f, t)) as { session_id: string; absence: string | null; participation: number; disruption: number }[];
      const by = new Map<string, { a: number; p: number; d: number }>();
      for (const r of rows) {
        if (r.session_id === i.id) continue;
        const x = by.get(r.session_id) ?? { a: 0, p: 0, d: 0 };
        if (r.absence) x.a++;
        x.p += r.participation; x.d += r.disruption;
        by.set(r.session_id, x);
      }
      const v = [...by.values()];
      if (v.length) setAvg({ n: v.length, absent: v.reduce((s, x) => s + x.a, 0) / v.length, participation: v.reduce((s, x) => s + x.p, 0) / v.length, disruption: v.reduce((s, x) => s + x.d, 0) / v.length });
    })();
  }, [i.id, i.subject.class_id, i.subject.id]);

  const name = new Map((students ?? []).map((s) => [s.id, s.full_name]));
  const nm = (id: string) => name.get(id) ?? "…";
  const absentEx = records.filter((r) => r.absence === "excused");
  const absentUn = records.filter((r) => r.absence === "unexcused");
  const late = records.filter((r) => r.late);
  const present = records.filter((r) => !r.absence).length;
  const part = records.reduce((s, r) => s + r.participation, 0);
  const maxP = Math.max(0, ...records.map((r) => r.participation));
  const topP = maxP ? records.filter((r) => r.participation === maxP) : [];
  const dis = records.filter((r) => r.disruption > 0);
  const hwDone = records.filter((r) => r.homework === "done").length;
  const hwMiss = records.filter((r) => r.homework === "missing").length;
  const notes = records.filter((r) => r.note);
  const absentAll = absentEx.length + absentUn.length;

  const compare: string[] = [];
  if (avg && avg.n >= 2) {
    if (absentAll >= avg.absent + 2 && absentAll > avg.absent * 1.5) compare.push(`${L.absent} أعلى من العادة (المعدل ${avg.absent.toFixed(1)})`);
    else if (avg.absent >= 1 && absentAll < avg.absent * 0.5) compare.push(`${L.absent} أقل من العادة (المعدل ${avg.absent.toFixed(1)})`);
    if (part > avg.participation * 1.3 && part - avg.participation >= 3) compare.push(`${L.participation} أعلى من العادة (المعدل ${avg.participation.toFixed(1)})`);
    else if (avg.participation >= 3 && part < avg.participation * 0.7) compare.push(`${L.participation} أقل من العادة (المعدل ${avg.participation.toFixed(1)})`);
    const d = dis.reduce((s, r) => s + r.disruption, 0);
    if (d >= avg.disruption + 2 && d > avg.disruption * 1.5) compare.push(`${L.disruption} أعلى من العادة (المعدل ${avg.disruption.toFixed(1)})`);
    if (!compare.length) compare.push(`ضمن العادة لحصص هذه المادة (${avg.n} حصة)`);
  }

  const Row = ({ label, value, names, tone }: { label: string; value: number | string; names?: string[]; tone?: string }) => (
    <div className="py-1.5">
      <div className="flex items-center justify-between"><span className="text-zinc-600 dark:text-zinc-400">{label}</span><b className={cx("tabular-nums", tone)}>{value}</b></div>
      {names && names.length > 0 && <div className="mt-0.5 text-xs text-zinc-500">{names.join("، ")}</div>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onMouseDown={onClose}>
      <aside role="dialog" aria-label="إحصائيات الحصة" className="flex h-full w-full max-w-sm flex-col overflow-y-auto bg-white p-4 shadow-xl dark:bg-zinc-900" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start gap-2">
          <span className="mt-1 h-8 w-1.5 rounded-full" style={{ background: i.subject.color }} />
          <div className="flex-1">
            <h2 className="font-semibold">{i.subject.name} · {i.subject.class_name}</h2>
            <div className="text-xs text-zinc-500">{fmtDate(i.date)}{i.start && ` · ${i.start}`}{i.session?.locked && " · 🔒 مقفلة"}</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="إغلاق">✕</button>
        </div>
        {!students ? <Spinner /> : (
          <div className="space-y-4 text-sm">
            <section>
              <h3 className="mb-1 text-xs font-semibold text-zinc-500">الحضور</h3>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <Row label="حاضر" value={present} tone="text-green-700 dark:text-green-400" />
                <Row label={`${L.absent} ${L.excused}`} value={absentEx.length} names={absentEx.map((r) => nm(r.student_id))} />
                <Row label={`${L.absent} ${L.unexcused}`} value={absentUn.length} names={absentUn.map((r) => nm(r.student_id))} tone={absentUn.length ? "text-red-600" : undefined} />
                <Row label={L.late} value={late.length} names={late.map((r) => nm(r.student_id))} />
              </div>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-zinc-500">{L.participation} و{L.disruption}</h3>
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <Row label={`مجموع ${L.participation}`} value={part} names={topP.length ? [`الأكثر: ${topP.map((r) => nm(r.student_id)).join("، ")} (${maxP})`] : undefined} />
                <Row label={L.disruption} value={dis.reduce((s, r) => s + r.disruption, 0)} names={dis.map((r) => `${nm(r.student_id)}${r.disruption > 1 ? ` (${r.disruption})` : ""}`)} tone={dis.length ? "text-red-600" : undefined} />
              </div>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-semibold text-zinc-500">{L.homework}</h3>
              <Row label={`${L.hw_done} / ${L.hw_missing}`} value={`${hwDone} / ${hwMiss}${hwDone + hwMiss ? ` (${Math.round((hwDone / (hwDone + hwMiss)) * 100)}%)` : ""}`} />
            </section>
            {(i.session?.topic || notes.length > 0) && (
              <section>
                <h3 className="mb-1 text-xs font-semibold text-zinc-500">الموضوع والملاحظات</h3>
                {i.session?.topic && <p>{i.session.topic}</p>}
                <ul className="mt-1 space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">{notes.map((r) => <li key={r.student_id}>📝 {nm(r.student_id)}: {r.note}</li>)}</ul>
              </section>
            )}
            {compare.length > 0 && (
              <section className="rounded-lg bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                <b>مقارنة سريعة:</b> {compare.join(" · ")}
              </section>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" onClick={onOpen}>فتح التسجيل</Button>
              <Link href={`/subject?id=${i.subject.id}&tab=stats`}><Button size="sm" variant="secondary">إحصائيات المادة</Button></Link>
              {absentAll > 0 && <Button size="sm" variant="secondary" onClick={() => setWa(students.filter((s) => records.some((r) => r.student_id === s.id && r.absence)))}>رسالة للغائبين</Button>}
            </div>
          </div>
        )}
        {wa && <WhatsAppQueue students={wa} classId={i.subject.class_id} onClose={() => setWa(null)} title="رسالة للغائبين" />}
      </aside>
    </div>
  );
}

/** «تعديل البرنامج»: أوقات كل مادة تُعدّل من صفحة المادة ← الحصص. */
function EditSchedule({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ id: string; name: string; color: string; classes: { name: string } }[] | null>(null);
  useEffect(() => {
    supabase().from("subjects").select("id,name,color,classes!inner(name,deleted_at,archived)").is("deleted_at", null).is("classes.deleted_at", null).eq("classes.archived", false).order("created_at")
      .then(({ data }) => setList((data ?? []) as never));
  }, []);
  return (
    <Modal open onClose={onClose} title="تعديل البرنامج">
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">أوقات الحصص تُعدّل لكل مادة: اختر المادة ← «+ موعد» أو ✎.</p>
      {!list ? <Spinner /> : list.length === 0 ? <p className="text-sm text-zinc-500">لا توجد مواد.</p> : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {list.map((s) => (
            <li key={s.id}>
              <Link href={`/subject?id=${s.id}&tab=sessions`} className="flex items-center gap-2 py-2 text-sm hover:text-brand-600">
                <span className="h-4 w-1 rounded" style={{ background: s.color }} />
                <span className="flex-1">{s.name}</span>
                <span className="text-xs text-zinc-500">{s.classes?.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

