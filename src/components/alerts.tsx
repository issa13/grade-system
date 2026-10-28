"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadAlertData } from "@/lib/alert-data";
import { computeAlerts, groupAlerts, visibleAlerts, type AlertData, type AlertGroup, type AlertItem } from "@/lib/alerts";
import { addDays } from "@/lib/schedule";
import { fmtDate, today } from "@/lib/dates";
import { ensureSession } from "@/lib/session-data";
import type { AlertState, Student } from "@/lib/types";
import { useSettings } from "./settings-provider";
import { WhatsAppQueue } from "./whatsapp";
import { Button, Modal, cx, useToast } from "./ui";

type Ctx = {
  groups: AlertGroup[];
  count: number;
  loaded: boolean;
  refresh: () => void;
  open: () => void;
  students: Student[];
};
const AlertsCtx = createContext<Ctx>({ groups: [], count: 0, loaded: false, refresh: () => {}, open: () => {}, students: [] });
export const useAlerts = () => useContext(AlertsCtx);

/** تُحسب التنبيهات عند فتح الموقع، وعند الرجوع إلى الصفحة الرئيسية أو فتح الجرس. */
export function AlertsProvider({ children }: { children: ReactNode }) {
  const { settings, loaded: sLoaded, subjectWeights } = useSettings();
  const [data, setData] = useState<AlertData | null>(null);
  const [states, setStates] = useState<AlertState[]>([]);
  const [panel, setPanel] = useState(false);
  const last = useRef(0);
  const busy = useRef(false);
  const path = usePathname();

  const refresh = useCallback(async (force = false) => {
    if (!sLoaded || busy.current) return;
    if (!force && Date.now() - last.current < 10_000) return;
    busy.current = true;
    try {
      const r = await loadAlertData(subjectWeights);
      setData(r.data);
      setStates(r.states);
      last.current = Date.now();
    } catch { /* بدون إنترنت ولا نسخة محفوظة */ }
    busy.current = false;
  }, [sLoaded, subjectWeights]);

  useEffect(() => { refresh(true); }, [refresh]);
  useEffect(() => { if (path === "/" || path === "/stats") refresh(); }, [path, refresh]);

  const t = today();
  const groups = useMemo(() => {
    if (!data) return [];
    return groupAlerts(visibleAlerts(computeAlerts(data, settings, t), states, t), settings);
  }, [data, states, settings, t]);
  const count = groups.reduce((a, g) => a + g.items.length, 0);

  const setState = useCallback(async (items: AlertItem[], status: "done" | "snoozed") => {
    const rows = items.map((i) => ({ key: i.key, status, fingerprint: i.fingerprint, snoozed_until: status === "snoozed" ? addDays(t, 7) : null, updated_at: new Date().toISOString() }));
    setStates((cur) => [...cur.filter((x) => !rows.some((r) => r.key === x.key)), ...rows]);
    const { data: u } = await supabase().auth.getUser();
    if (u.user) await supabase().from("alert_states").upsert(rows.map((r) => ({ ...r, owner_id: u.user!.id })), { onConflict: "owner_id,key" });
  }, [t]);

  const ctx: Ctx = {
    groups, count, loaded: !!data,
    refresh: () => refresh(true),
    open: () => { setPanel(true); refresh(); },
    students: data?.students ?? [],
  };
  return (
    <AlertsCtx.Provider value={ctx}>
      {children}
      {panel && <AlertsPanel groups={groups} students={ctx.students} onClose={() => setPanel(false)} setState={setState} />}
    </AlertsCtx.Provider>
  );
}

export function Bell({ className }: { className?: string }) {
  const { count, open } = useAlerts();
  return (
    <button onClick={open} className={cx("no-print relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-zinc-100 dark:hover:bg-zinc-800", className)}
      aria-label={count ? `التنبيهات: ${count}` : "التنبيهات"} title="التنبيهات">
      <span aria-hidden>🔔</span>
      {count > 0 && <span className="absolute -top-0.5 -left-0.5 min-w-[1.25rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-5 text-white">{count > 99 ? "99+" : count}</span>}
    </button>
  );
}

function useOpenItem(onDone?: () => void) {
  const router = useRouter();
  return (i: AlertItem) => {
    if (i.create) ensureSession(i.create);
    router.push(i.href);
    onDone?.();
  };
}

function AlertsPanel({ groups, students, onClose, setState }: { groups: AlertGroup[]; students: Student[]; onClose: () => void; setState: (i: AlertItem[], s: "done" | "snoozed") => void }) {
  const [openRule, setOpenRule] = useState<string | null>(groups.length === 1 ? groups[0].rule : null);
  const [wa, setWa] = useState<{ st: Student } | null>(null);
  const toast = useToast();
  const go = useOpenItem(onClose);
  const stById = new Map(students.map((s) => [s.id, s]));
  return (
    <Modal open onClose={onClose} title="التنبيهات" wide>
      {groups.length === 0 ? <p className="py-6 text-center text-sm text-zinc-500">لا توجد تنبيهات 👍</p> : (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li key={g.rule} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button className="flex flex-1 items-center gap-2 text-right font-medium" onClick={() => setOpenRule(openRule === g.rule ? null : g.rule)} aria-expanded={openRule === g.rule}>
                  <span className="text-zinc-400">{openRule === g.rule ? "▾" : "◂"}</span>{g.title}
                </button>
                <Button size="sm" variant="ghost" onClick={() => { setState(g.items, "done"); toast({ text: "تمّ", kind: "ok" }); }}>تمّ للكل</Button>
              </div>
              {openRule === g.rule && (
                <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                  {g.items.map((i) => {
                    const st = i.studentId ? stById.get(i.studentId) : undefined;
                    return (
                      <li key={i.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                        <button className="min-w-0 flex-1 text-right hover:text-brand-600 hover:underline" onClick={() => go(i)}>
                          {i.label}
                          {i.detail && <span className="ms-2 text-xs text-zinc-500">{i.rule === "unlogged" && i.date ? fmtDate(i.date) : i.detail}</span>}
                        </button>
                        {st?.phone && <Button size="sm" variant="ghost" onClick={() => setWa({ st })}>رسالة للطالب</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setState([i], "done")}>تمّ</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setState([i], "snoozed"); toast({ text: "سنذكّرك بعد أسبوع", kind: "ok" }); }}>ذكّرني بعد أسبوع</Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-zinc-500">«تمّ» يخفي التنبيه حتى تحدث حالة جديدة (مثلاً غياب جديد). القواعد وأرقامها من الإعدادات ← التنبيهات.</p>
      {wa && <WhatsAppQueue students={[wa.st]} classId={wa.st.class_id} onClose={() => setWa(null)} />}
    </Modal>
  );
}

/** شريط فوق البرنامج الأسبوعي بأهم 3 تنبيهات. */
export function AlertsStrip() {
  const { groups, open } = useAlerts();
  if (!groups.length) return null;
  const top = groups.slice(0, 3);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-sm dark:border-amber-900 dark:bg-amber-950/30">
      <span aria-hidden className="px-1">🔔</span>
      {top.map((g) => (
        <button key={g.rule} onClick={open} className="rounded-lg bg-white px-3 py-1 text-amber-900 shadow-sm hover:bg-amber-100 dark:bg-zinc-900 dark:text-amber-200 dark:hover:bg-zinc-800">{g.title}</button>
      ))}
      {groups.length > 3 && <button onClick={open} className="text-xs text-amber-800 underline dark:text-amber-300">+{groups.length - 3} أخرى</button>}
      <Link href="/settings?section=alerts" className="ms-auto text-xs text-amber-800/70 hover:underline dark:text-amber-300/70">إعدادات التنبيهات</Link>
    </div>
  );
}
