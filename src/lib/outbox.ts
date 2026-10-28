"use client";
// «صندوق الصادر»: كل تعديل في تسجيل الحصة وكشف العلامات والواجبات يُكتب أولاً على الجهاز
// (IndexedDB) ثم يُرسل وحده عند وجود اتصال. التعديلات على نفس المفتاح تُدمج ويبقى آخرها.
import { supabase } from "./supabase/client";
import { idbDel, idbEntries, idbSet } from "./idb";
import { isOnline, onConnectivity, setOnline } from "./offline-fetch";

export type OutboxTable = "session_records" | "grade_entries" | "assignment_submissions" | "sessions";
type Row = Record<string, unknown>;

/** الأعمدة التي تحدد السطر (نفس قيد unique في قاعدة البيانات). */
const CONFLICT: Record<OutboxTable, string> = {
  session_records: "session_id,student_id",
  grade_entries: "subject_id,student_id,component",
  assignment_submissions: "assignment_id,student_id",
  sessions: "id",
};
/** جداول فيها حماية من الكتابة القديمة (trigger في قاعدة البيانات). */
const PROTECTED = new Set<OutboxTable>(["session_records", "grade_entries", "assignment_submissions"]);

export type Entry = { key: string; seq: number; table: OutboxTable; op: "upsert" | "update"; row: Row; at: number; v: number };
export type Rejected = { id: string; table: OutboxTable; key: string; row: Row; reason: "stale" | "error"; message?: string; at: number };
export type SyncStatus = "saved" | "syncing" | "offline" | "auth" | "error";
export type SyncState = { ready: boolean; pending: number; status: SyncStatus; online: boolean; rejected: Rejected[]; lastSync: number | null };

const entries = new Map<string, Entry>();
let rejected: Rejected[] = [];
let ready = false;
let flushing = false;
let again = false;
let authNeeded = false;
let lastSync: number | null = null;
let seqCounter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let state: SyncState = { ready: false, pending: 0, status: "saved", online: true, rejected: [], lastSync: null };

export const keyOf = (table: OutboxTable, row: Row) => table + "|" + CONFLICT[table].split(",").map((c) => String(row[c])).join("|");

function compute(): SyncState {
  const online = isOnline();
  const pending = entries.size;
  const status: SyncStatus = authNeeded ? "auth"
    : !online ? "offline"
    : flushing || pending > 0 ? "syncing"
    : rejected.length ? "error"
    : "saved";
  return { ready, pending, status, online, rejected, lastSync };
}
function emit() {
  state = compute();
  listeners.forEach((f) => f());
}
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getState(): SyncState { return state; }

function schedule(ms = 400) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(); }, ms);
}

/**
 * إضافة تعديل إلى الصادر. op = "upsert" (سطر كامل) أو "update" (تعديل أعمدة سطر له id).
 * وقت الضغطة يُحفظ في updated_at حتى «يربح الأحدث» بين جهازين.
 */
export function enqueue(table: OutboxTable, row: Row, op: "upsert" | "update" = "upsert") {
  const r: Row = { ...row };
  delete r.owner_id;
  if (table !== "sessions") delete r.id;
  for (const k of Object.keys(r)) if (r[k] && typeof r[k] === "object") delete r[k]; // أعمدة من جداول مرتبطة
  if (PROTECTED.has(table)) r.updated_at = new Date().toISOString();
  const key = keyOf(table, r);
  const cur = entries.get(key);
  const e: Entry = cur
    ? { ...cur, row: { ...cur.row, ...r }, op: cur.op === "upsert" || op === "upsert" ? "upsert" : "update", at: Date.now(), v: cur.v + 1 }
    : { key, seq: Date.now() * 1000 + (seqCounter++ % 1000), table, op, row: r, at: Date.now(), v: 1 };
  entries.set(key, e);
  idbSet("outbox", key, e);
  emit();
  schedule();
}

/** التعديلات التي لم تُرسل بعد لجدول معيّن (لعرضها فوق البيانات المحفوظة). */
export function pendingRows(table: OutboxTable, match?: (r: Row) => boolean): Row[] {
  const out: Row[] = [];
  for (const e of entries.values()) if (e.table === table && (!match || match(e.row))) out.push(e.row);
  return out;
}

/** دمج التعديلات غير المرسلة مع سطور قادمة من قاعدة البيانات أو من النسخة المحفوظة. */
export function overlay<T extends object>(table: OutboxTable, rows: T[], match?: (r: Row) => boolean): T[] {
  const pend = pendingRows(table, match);
  if (!pend.length) return rows;
  const map = new Map<string, T>();
  for (const r of rows) map.set(keyOf(table, r as Row), r);
  for (const p of pend) {
    const k = keyOf(table, p);
    map.set(k, { ...(map.get(k) ?? {}), ...p } as T);
  }
  return [...map.values()];
}

function done(e: Entry) {
  const cur = entries.get(e.key);
  if (cur && cur.v === e.v) {
    entries.delete(e.key);
    idbDel("outbox", e.key);
  }
}
function reject(e: Entry, reason: Rejected["reason"], message?: string) {
  const r: Rejected = { id: `${e.key}|${Date.now()}`, table: e.table, key: e.key, row: e.row, reason, message, at: Date.now() };
  rejected = [...rejected, r];
  idbSet("rejected", r.id, r);
  done(e);
}

type PgErr = { message?: string; code?: string } | null;
const isNetwork = (status: number, err: PgErr) => status === 0 || /fetch|network|load failed/i.test(err?.message ?? "") && !err?.code;
const isAuth = (status: number, err: PgErr) => status === 401 || err?.code === "PGRST301" || err?.code === "PGRST303" || /jwt/i.test(err?.message ?? "");

/** ترسل مجموعة سطور. تعيد "stop" إذا انقطع الاتصال أو انتهى تسجيل الدخول. */
async function send(batch: Entry[]): Promise<"ok" | "stop"> {
  const sb = supabase();
  const head = batch[0];
  const table = head.table;
  if (head.op === "update") {
    const { id, ...rest } = head.row;
    const { error, status } = await sb.from(table).update(rest).eq("id", id as string);
    if (error) return fail(batch, status, error);
    done(head);
    return "ok";
  }
  const cols = CONFLICT[table];
  const { data, error, status } = await sb.from(table).upsert(batch.map((e) => e.row), { onConflict: cols }).select(cols);
  if (error) return fail(batch, status, error);
  const back = new Set(((data ?? []) as unknown as Row[]).map((r) => keyOf(table, r)));
  for (const e of batch) {
    if (back.has(e.key)) done(e);
    else if (PROTECTED.has(table)) reject(e, "stale"); // قاعدة البيانات فيها تعديل أحدث من جهاز آخر
    else done(e);
  }
  return "ok";
}

async function fail(batch: Entry[], status: number, error: PgErr): Promise<"ok" | "stop"> {
  if (isNetwork(status, error)) { setOnline(false); return "stop"; }
  if (isAuth(status, error)) { authNeeded = true; return "stop"; }
  if (batch.length > 1) {
    // نجرّب كل سطر وحده حتى لا يوقف سطر واحد خاطئ الباقي
    for (const e of batch) if ((await send([e])) === "stop") return "stop";
    return "ok";
  }
  const e = batch[0];
  if (e.table === "sessions" && error?.code === "23505" && e.row.schedule_slot_id && e.row.date) {
    // الحصة أُنشئت من جهاز آخر بمعرّف مختلف: نربط التسجيلات بها
    const { data } = await supabase().from("sessions").select("id").eq("schedule_slot_id", e.row.schedule_slot_id as string)
      .eq("date", e.row.date as string).is("deleted_at", null).maybeSingle();
    if (data?.id) { remapSession(String(e.row.id), data.id as string); done(e); return "ok"; }
  }
  reject(e, "error", error?.message);
  return "ok";
}

const remapListeners = new Set<(from: string, to: string) => void>();
export function onSessionRemap(fn: (from: string, to: string) => void) { remapListeners.add(fn); return () => { remapListeners.delete(fn); }; }

function remapSession(from: string, to: string) {
  for (const e of [...entries.values()]) {
    if (e.table === "session_records" && e.row.session_id === from) {
      entries.delete(e.key);
      idbDel("outbox", e.key);
      const row = { ...e.row, session_id: to };
      const key = keyOf("session_records", row);
      const ne: Entry = { ...e, key, row };
      entries.set(key, ne);
      idbSet("outbox", key, ne);
    }
    if (e.table === "sessions" && e.row.id === from && e.op === "update") {
      entries.delete(e.key);
      idbDel("outbox", e.key);
      const row = { ...e.row, id: to };
      const ne: Entry = { ...e, key: keyOf("sessions", row), row };
      entries.set(ne.key, ne);
      idbSet("outbox", ne.key, ne);
    }
  }
  remapListeners.forEach((f) => f(from, to));
}

/** إرسال كل ما في الصادر (عند عودة الاتصال، عند فتح التطبيق، وكل 30 ثانية). */
export async function flush(): Promise<void> {
  if (!ready) return;
  if (flushing) { again = true; return; }
  if (!entries.size) { emit(); return; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) { setOnline(false); emit(); return; }
  flushing = true;
  emit();
  try {
    const sb = supabase();
    // تجديد تسجيل الدخول أولاً
    const { data, error } = await sb.auth.getSession();
    if (!data.session) {
      const retryable = error && (error.name === "AuthRetryableFetchError" || (error as { status?: number }).status === 0);
      if (retryable) setOnline(false);
      else authNeeded = true;
      return;
    }
    authNeeded = false;
    const list = [...entries.values()].sort((a, b) => a.seq - b.seq);
    let i = 0;
    while (i < list.length) {
      const head = list[i];
      const batch = [head];
      let j = i + 1;
      // سطور الدفعة الواحدة يجب أن تحمل نفس الأعمدة (وإلا تُكتب الأعمدة الناقصة فارغة)
      const sig = (e: Entry) => e.table + ":" + Object.keys(e.row).sort().join(",");
      while (head.op === "upsert" && j < list.length && batch.length < 100 && list[j].op === "upsert" && sig(list[j]) === sig(head)) batch.push(list[j++]);
      if ((await send(batch)) === "stop") return;
      i = j;
    }
    lastSync = Date.now();
    setOnline(true);
  } catch {
    setOnline(false);
  } finally {
    flushing = false;
    emit();
    if (again) { again = false; schedule(50); }
  }
}

/** بعد إعادة تسجيل الدخول. */
export function resumeAfterLogin() {
  authNeeded = false;
  emit();
  flush();
}

/** «تعديلات لم تُطبّق»: تطبيقها على أي حال (بوقت جديد) أو تجاهلها. */
export function resolveRejected(id: string, action: "apply" | "discard") {
  const r = rejected.find((x) => x.id === id);
  if (!r) return;
  rejected = rejected.filter((x) => x.id !== id);
  idbDel("rejected", id);
  if (action === "apply") enqueue(r.table, r.row, "upsert");
  else emit();
}

let started = false;
/** يُستدعى مرة واحدة عند فتح التطبيق. */
export async function startOutbox() {
  if (started || typeof window === "undefined") return;
  started = true;
  const [es, rs] = await Promise.all([idbEntries<Entry>("outbox"), idbEntries<Rejected>("rejected")]);
  for (const [k, e] of es) if (e && !entries.has(k)) entries.set(k, e);
  rejected = rs.map(([, r]) => r).filter(Boolean).sort((a, b) => a.at - b.at);
  ready = true;
  emit();
  onConnectivity((on) => { emit(); if (on) schedule(200); });
  window.addEventListener("online", () => schedule(200));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") schedule(200); });
  setInterval(() => { if (entries.size) flush(); }, 30_000);
  flush();
}
