"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { fmtDate, weekdayOf } from "@/lib/dates";
import { WEEKDAYS, type ClassRow, type Session, type SessionRecord, type Student, type Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { Button, Card, Empty, Input, Spinner, cx, useToast } from "@/components/ui";

const blank = (session_id: string, student_id: string): SessionRecord => ({
  session_id, student_id, participation: 0, disruption: 0, late: false, absence: null, homework: null, note: null,
});

export default function SessionPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <SessionPageView key={id} id={id} />;
}

function SessionPageView({ id }: { id: string }) {
  const { settings } = useSettings();
  const L = settings.labels;
  const toast = useToast();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [recs, setRecs] = useState<Record<string, SessionRecord>>({});
  const [siblings, setSiblings] = useState<{ prev?: string; next?: string }>({});
  const [focus, setFocus] = useState(0);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const history = useRef<SessionRecord[]>([]);
  const latest = useRef<Record<string, SessionRecord>>({});

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const { data: s } = await sb.from("sessions").select("*").eq("id", id).single();
      setSession((s as Session) ?? null);
      if (!s) return;
      const { data: sj } = await sb.from("subjects").select("*").eq("id", s.subject_id).single();
      const subj = sj as Subject;
      setSubject(subj);
      const [c, st, r, sib] = await Promise.all([
        sb.from("classes").select("*").eq("id", subj.class_id).single(),
        sb.from("students").select("*").eq("class_id", subj.class_id).is("deleted_at", null).eq("active", true).order("sort_order").order("full_name"),
        sb.from("session_records").select("*").eq("session_id", id),
        sb.from("sessions").select("id,date").eq("subject_id", s.subject_id).is("deleted_at", null).eq("cancelled", false).order("date"),
      ]);
      setCls(c.data as ClassRow);
      setStudents((st.data ?? []) as Student[]);
      const m: Record<string, SessionRecord> = {};
      (r.data ?? []).forEach((x: SessionRecord) => (m[x.student_id] = x));
      setRecs(m);
      latest.current = m;
      const list = (sib.data ?? []) as { id: string; date: string }[];
      const i = list.findIndex((x) => x.id === id);
      setSiblings({ prev: list[i - 1]?.id, next: list[i + 1]?.id });
    })();
  }, [id]);

  const save = useCallback((rec: SessionRecord) => {
    if (timers.current[rec.student_id]) clearTimeout(timers.current[rec.student_id]);
    else setPending((n) => n + 1);
    timers.current[rec.student_id] = setTimeout(async () => {
      delete timers.current[rec.student_id];
      const r = latest.current[rec.student_id];
      const { error } = await supabase().from("session_records").upsert(
        { session_id: r.session_id, student_id: r.student_id, participation: r.participation, disruption: r.disruption,
          late: r.late, absence: r.absence, homework: r.homework, note: r.note, updated_at: new Date().toISOString() },
        { onConflict: "session_id,student_id" },
      );
      setPending((n) => n - 1);
      if (error) toast({ text: "لم يتم الحفظ: " + error.message, kind: "err" });
    }, 250);
  }, [toast]);

  const patch = useCallback((studentId: string, f: (r: SessionRecord) => Partial<SessionRecord>, record = true) => {
    if (session?.locked) return toast({ text: "الحصة مقفلة", kind: "err" });
    const cur = latest.current[studentId] ?? blank(id, studentId);
    if (record) history.current.push(cur);
    const next = { ...cur, ...f(cur) };
    latest.current = { ...latest.current, [studentId]: next };
    setRecs(latest.current);
    save(next);
  }, [id, save, session?.locked, toast]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    if (!prev) return;
    patch(prev.student_id, () => prev, false);
  }, [patch]);

  async function bulk(f: (r: SessionRecord) => Partial<SessionRecord>, msg: string) {
    if (session?.locked) return;
    const rows = students.map((st) => {
      const cur = latest.current[st.id] ?? blank(id, st.id);
      history.current.push(cur);
      return { ...cur, ...f(cur) };
    });
    latest.current = Object.fromEntries(rows.map((r) => [r.student_id, r]));
    setRecs(latest.current);
    const { error } = await supabase().from("session_records").upsert(
      rows.map(({ id: _i, ...r }) => { void _i; return { ...r, updated_at: new Date().toISOString() }; }),
      { onConflict: "session_id,student_id" },
    );
    toast(error ? { text: error.message, kind: "err" } : { text: msg, kind: "ok" });
  }

  async function updateSession(p: Partial<Session>) {
    setSession((s) => (s ? { ...s, ...p } : s));
    await supabase().from("sessions").update(p).eq("id", id);
  }

  const max = settings.behavior.participation_max_per_session;
  const actions = {
    part: (s: string, d = 1) => patch(s, (r) => ({ participation: Math.max(0, Math.min(max || 99, r.participation + d)) })),
    dis: (s: string, d = 1) => patch(s, (r) => ({ disruption: Math.max(0, r.disruption + d) })),
    late: (s: string) => patch(s, (r) => ({ late: !r.late, absence: r.late ? r.absence : null })),
    abs: (s: string) => patch(s, (r) => ({ absence: r.absence === null ? "unexcused" : r.absence === "unexcused" ? "excused" : null, late: false })),
    hw: (s: string) => patch(s, (r) => ({ homework: r.homework === null ? "done" : r.homework === "done" ? "missing" : null })),
  };

  // اختصارات لوحة المفاتيح
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.matches("input, textarea")) return;
      const st = students[focus];
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setFocus((f) => Math.min(students.length - 1, f + 1)); return; }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); return; }
      if (!st) return;
      const map: Record<string, () => void> = {
        "1": () => actions.part(st.id), "!": () => actions.part(st.id, -1),
        "2": () => actions.dis(st.id), "@": () => actions.dis(st.id, -1),
        "3": () => actions.late(st.id), "4": () => actions.abs(st.id), "5": () => actions.hw(st.id),
        n: () => setNoteFor(st.id),
      };
      const fn = map[e.key];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  useEffect(() => {
    document.querySelector(`[data-row="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  if (session === undefined || (session && !cls)) return <Spinner />;
  if (!session || !subject || !cls) return <Empty>الحصة غير موجودة.</Empty>;

  const vals = Object.values(recs);
  const stats = {
    absent: vals.filter((r) => r.absence).length,
    late: vals.filter((r) => r.late).length,
    part: vals.reduce((a, r) => a + r.participation, 0),
    dis: vals.reduce((a, r) => a + r.disruption, 0),
  };

  return (
    <div>
      <div className="mb-2 text-sm text-zinc-500">
        <Link href="/" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${cls.id}`} className="hover:underline">{cls.name}</Link> ‹ <Link href={`/subject?id=${subject.id}`} className="hover:underline">{subject.name}</Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{WEEKDAYS[weekdayOf(session.date)]} {fmtDate(session.date)}</h1>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">الفصل {session.semester}</span>
        <button onClick={() => updateSession({ semester: session.semester === 1 ? 2 : 1 })} className="text-xs text-zinc-500 hover:underline">تغيير الفصل</button>
        <div className="flex-1" />
        <span className={cx("text-xs", pending ? "text-amber-600" : "text-green-600")}>{pending ? "جارٍ الحفظ…" : "✓ محفوظ"}</span>
        {siblings.prev && <Link href={`/session?id=${siblings.prev}`}><Button size="sm" variant="secondary">→ السابقة</Button></Link>}
        {siblings.next && <Link href={`/session?id=${siblings.next}`}><Button size="sm" variant="secondary">التالية ←</Button></Link>}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-sm" placeholder="موضوع الحصة (اختياري)" defaultValue={session.topic ?? ""} onBlur={(e) => updateSession({ topic: e.target.value || null })} />
        <Button size="sm" variant="secondary" onClick={() => bulk(() => ({ absence: null, late: false }), "الكل حاضر")}>✓ الكل حاضر</Button>
        <Button size="sm" variant="secondary" onClick={() => bulk((r) => ({ homework: r.absence ? r.homework : "done" }), "تم")}>الكل أنجز الوظيفة</Button>
        <Button size="sm" variant="secondary" onClick={undo}>↶ تراجع</Button>
        <Button size="sm" variant={session.locked ? "primary" : "ghost"} onClick={() => updateSession({ locked: !session.locked })}>{session.locked ? "🔒 مقفلة" : "قفل الحصة"}</Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        <span>{L.absent}: <b>{stats.absent}</b></span>
        <span>{L.late}: <b>{stats.late}</b></span>
        <span>{L.participation}: <b>{stats.part}</b></span>
        <span>{L.disruption}: <b>{stats.dis}</b></span>
      </div>

      {students.length === 0 ? <Empty>لا يوجد طلاب.</Empty> : (
        <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
          {students.map((st, i) => {
            const r = recs[st.id] ?? blank(id, st.id);
            return (
              <div key={st.id} data-row={i} onClick={() => setFocus(i)}
                className={cx("flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap", focus === i && "bg-brand-50 ring-1 ring-inset ring-brand-500 dark:bg-brand-700/20", r.absence && "opacity-70")}>
                <span className="w-6 text-xs text-zinc-400">{i + 1}</span>
                <span className="min-w-[140px] flex-1 font-medium">{st.full_name}
                  {r.note && <span className="ms-2 text-xs font-normal text-zinc-500">📝 {r.note}</span>}
                </span>

                <Counter label={L.participation} value={r.participation} color="green" onInc={() => actions.part(st.id)} onDec={() => actions.part(st.id, -1)} />
                <Counter label={L.disruption} value={r.disruption} color="red" onInc={() => actions.dis(st.id)} onDec={() => actions.dis(st.id, -1)} />

                <Toggle on={r.late} onClick={() => actions.late(st.id)} cls="bg-amber-500">{L.late}</Toggle>
                <Toggle on={!!r.absence} onClick={() => actions.abs(st.id)} cls={r.absence === "excused" ? "bg-sky-600" : "bg-red-600"}>
                  {r.absence === "excused" ? `${L.absent} ${L.excused}` : r.absence === "unexcused" ? `${L.absent}` : L.absent}
                </Toggle>
                <Toggle on={!!r.homework} onClick={() => actions.hw(st.id)} cls={r.homework === "missing" ? "bg-red-600" : "bg-green-600"}>
                  {r.homework === "done" ? `✓ ${L.homework}` : r.homework === "missing" ? `✗ ${L.homework}` : L.homework}
                </Toggle>
                <button onClick={(e) => { e.stopPropagation(); setNoteFor(noteFor === st.id ? null : st.id); }} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={L.note}>📝</button>

                {noteFor === st.id && (
                  <Input autoFocus className="mt-1 basis-full" placeholder={L.note} defaultValue={r.note ?? ""}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setNoteFor(null); }}
                    onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== r.note) patch(st.id, () => ({ note: v })); setNoteFor(null); }} />
                )}
              </div>
            );
          })}
        </Card>
      )}
      <p className="mt-3 text-xs text-zinc-500">
        اختصارات: ↑↓ لاختيار الطالب · 1 {L.participation} (Shift للإنقاص) · 2 {L.disruption} · 3 {L.late} · 4 {L.absent} (بدون عذر ← بعذر ← حاضر) · 5 {L.homework} · N {L.note} · Ctrl+Z تراجع
      </p>
    </div>
  );
}

function Counter({ label, value, onInc, onDec, color }: { label: string; value: number; onInc: () => void; onDec: () => void; color: "green" | "red" }) {
  return (
    <div className={cx("flex items-center overflow-hidden rounded-lg border text-sm",
      value ? (color === "green" ? "border-green-600" : "border-red-600") : "border-zinc-200 dark:border-zinc-700")}>
      <button onClick={(e) => { e.stopPropagation(); onInc(); }}
        className={cx("px-2.5 py-1 font-medium", value ? (color === "green" ? "bg-green-600 text-white" : "bg-red-600 text-white") : "hover:bg-zinc-100 dark:hover:bg-zinc-800")}>
        {label}{value ? ` ${value}` : ""}
      </button>
      {value > 0 && <button onClick={(e) => { e.stopPropagation(); onDec(); }} className="px-1.5 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label={`إنقاص ${label}`}>−</button>}
    </div>
  );
}

function Toggle({ on, onClick, cls, children }: { on: boolean; onClick: () => void; cls: string; children: React.ReactNode }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} aria-pressed={on}
      className={cx("rounded-lg border px-2.5 py-1 text-sm font-medium", on ? `${cls} border-transparent text-white` : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800")}>
      {children}
    </button>
  );
}
