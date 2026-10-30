"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAlerts } from "./alerts";
import { cx } from "./ui";

const norm = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْ]/g, "").toLowerCase().trim();

/** بحث سريع عن طالب (Ctrl+K أو /): يفتح صفحة الطالب مباشرة. */
export function QuickSearch() {
  const { students } = useAlerts();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.matches("input, textarea, select, [contenteditable]");
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const o = () => setOpen(true);
    window.addEventListener("keydown", h);
    window.addEventListener("open-search", o);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("open-search", o); };
  }, []);
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => input.current?.focus(), 20); } }, [open]);

  const results = useMemo(() => {
    const n = norm(q);
    if (!n) return [];
    return students.filter((s) => norm(s.full_name).includes(n) || (s.student_number ?? "").includes(n)).slice(0, 8);
  }, [q, students]);

  if (!open) return null;
  const go = (id: string) => { setOpen(false); router.push(`/student?id=${id}`); };
  return (
    <div className="fixed inset-0 z-[65] flex items-start justify-center bg-black/40 p-4 pt-24" onMouseDown={() => setOpen(false)}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-zinc-900" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="بحث عن طالب">
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0); }} placeholder="ابحث عن طالب بالاسم أو الرقم…"
          className="w-full rounded-t-xl border-b border-zinc-200 bg-transparent px-4 py-3 text-base outline-none dark:border-zinc-800"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(results.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
            if (e.key === "Enter" && results[i]) go(results[i].id);
          }} />
        <ul className="max-h-80 overflow-y-auto p-1">
          {q && !results.length && <li className="p-3 text-sm text-zinc-500">لا يوجد طالب بهذا الاسم.</li>}
          {results.map((s, k) => (
            <li key={s.id}>
              <button onMouseEnter={() => setI(k)} onClick={() => go(s.id)} className={cx("flex w-full items-center rounded-lg px-3 py-2 text-right text-sm", k === i && "bg-brand-50 dark:bg-brand-700/30")}>{s.full_name}</button>
            </li>
          ))}
        </ul>
        <p className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-400 dark:border-zinc-800">Ctrl+K أو / للبحث · ↑↓ للاختيار · Enter للفتح</p>
      </div>
    </div>
  );
}
