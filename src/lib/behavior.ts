import type { BehaviorAgg } from "./grades";
import type { Session, SessionRecord, Assignment, Submission } from "./types";

export type AggMap = Record<string, { 1?: BehaviorAgg; 2?: BehaviorAgg }>; // key = student_id

function add(a: BehaviorAgg, b: BehaviorAgg): BehaviorAgg {
  const out: BehaviorAgg = { ...a };
  for (const k of Object.keys(b) as (keyof BehaviorAgg)[]) out[k] = (out[k] ?? 0) + (b[k] ?? 0);
  return out;
}

/** تجميع سجلات الحصص والوظائف لكل طالب ولكل فصل. */
export function aggregate(
  sessions: Session[],
  records: SessionRecord[],
  assignments: Assignment[] = [],
  submissions: Submission[] = [],
): AggMap {
  const sem = new Map(sessions.filter((s) => !s.cancelled && !s.deleted_at).map((s) => [s.id, s.semester]));
  const out: AggMap = {};
  for (const r of records) {
    const sm = sem.get(r.session_id);
    if (!sm) continue;
    const cur = (out[r.student_id] ??= {});
    cur[sm] = add(cur[sm] ?? {}, {
      sessions: 1,
      participation: r.participation,
      disruption: r.disruption,
      late: r.late ? 1 : 0,
      absent_excused: r.absence === "excused" ? 1 : 0,
      absent_unexcused: r.absence === "unexcused" ? 1 : 0,
      hw_done: r.homework === "done" ? 1 : 0,
      hw_missing: r.homework === "missing" ? 1 : 0,
    });
  }
  const asem = new Map(assignments.filter((a) => !a.deleted_at).map((a) => [a.id, a.semester]));
  for (const s of submissions) {
    const sm = asem.get(s.assignment_id);
    if (!sm || !s.status) continue;
    const cur = (out[s.student_id] ??= {});
    cur[sm] = add(cur[sm] ?? {}, {
      hw_done: s.status === "done" || s.status === "late" ? 1 : 0,
      hw_missing: s.status === "missing" ? 1 : 0,
    });
  }
  return out;
}

/** من نتيجة RPC الخاصة بصفحة الطالب. */
export function aggregateFromReport(
  behavior: (BehaviorAgg & { subject_id: string; semester: 1 | 2 })[],
  assignments: { subject_id: string; semester: 1 | 2; done: number; late: number; missing: number }[],
): Record<string, { 1?: BehaviorAgg; 2?: BehaviorAgg }> {
  const out: Record<string, { 1?: BehaviorAgg; 2?: BehaviorAgg }> = {};
  for (const b of behavior) {
    const cur = (out[b.subject_id] ??= {});
    const { subject_id: _s, semester, ...rest } = b;
    void _s;
    cur[semester] = add(cur[semester] ?? {}, rest);
  }
  for (const a of assignments) {
    const cur = (out[a.subject_id] ??= {});
    cur[a.semester] = add(cur[a.semester] ?? {}, { hw_done: Number(a.done) + Number(a.late), hw_missing: Number(a.missing) });
  }
  return out;
}
