"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { TREND_ARROW, TREND_LABEL, type Dates, type Exam, type Trend } from "@/lib/trajectory";
import type { Subject } from "@/lib/types";
import { cx } from "./ui";

/** سهم صغير ↑ ↓ → بجانب اسم الطالب (اتجاه آخر 3 علامات). */
export function TrendArrow({ t }: { t: Trend }) {
  return (
    <span className={cx("ms-1.5 text-xs font-bold", t === "up" ? "text-green-700 dark:text-green-400" : t === "down" ? "text-red-600 dark:text-red-400" : "text-zinc-400")}
      title={`الاتجاه: ${TREND_LABEL[t]}`} aria-label={TREND_LABEL[t]}>{TREND_ARROW[t]}</span>
  );
}

/** تواريخ الامتحانات لمجموعة مواد. */
export function useAssessmentDates(subjects: Subject[]): Record<string, Dates> {
  const [dates, setDates] = useState<Record<string, Dates>>({});
  const ids = subjects.map((s) => s.id).join(",");
  useEffect(() => {
    if (!ids) return;
    supabase().from("assessment_dates").select("subject_id,component,date").in("subject_id", ids.split(",")).then(({ data }) => {
      const out: Record<string, Dates> = {};
      for (const x of (data ?? []) as { subject_id: string; component: Exam; date: string }[]) (out[x.subject_id] ??= {})[x.component] = x.date;
      setDates(out);
    });
  }, [ids]);
  return dates;
}
