"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** زر ⓘ صغير يفتح شرحاً قصيراً. يعمل باللمس والفأرة ولوحة المفاتيح. */
export function Info({ children, title }: { children: ReactNode; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(300, window.innerWidth - 24);
      let left = r.left + r.width / 2 - w / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
      const below = r.bottom + 8;
      const h = box.current?.offsetHeight ?? 120;
      const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : below;
      setPos({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setOpen(false); return; }
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !box.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("touchstart", close);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("touchstart", close);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={title ? `شرح: ${title}` : "شرح"}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        className="no-print mx-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-400 align-middle text-[10px] font-bold leading-none text-zinc-500 hover:border-brand-500 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-500 dark:border-zinc-500 dark:text-zinc-400"
      >
        i
      </button>
      {open && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={box}
            role="tooltip"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(300, typeof window !== "undefined" ? window.innerWidth - 24 : 300) }}
            className="fixed z-[70] rounded-lg border border-zinc-200 bg-white p-3 text-right text-xs font-normal leading-6 text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            dir="rtl"
          >
            {title && <div className="mb-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>}
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
