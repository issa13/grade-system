"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { Button, Card, Empty, PageHeader, Select, Spinner, confirmAction, useToast } from "@/components/ui";

type Log = { id: number; table_name: string; row_id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; at: string };

const TABLE_AR: Record<string, string> = {
  classes: "صف", students: "طالب", subjects: "مادة", schedule_slots: "موعد", sessions: "حصة", session_records: "تسجيل حصة",
  assignments: "واجب", assignment_submissions: "تسليم واجب", grade_entries: "علامة", settings: "إعدادات",
};
const ACTION_AR: Record<string, string> = { INSERT: "إضافة", UPDATE: "تعديل", DELETE: "حذف" };
const SKIP = new Set(["id", "owner_id", "created_at", "updated_at"]);

function diff(l: Log): string {
  if (l.action === "INSERT") return describe(l.after);
  if (l.action === "DELETE") return describe(l.before);
  const parts: string[] = [];
  for (const k of Object.keys(l.after ?? {})) {
    if (SKIP.has(k)) continue;
    const a = JSON.stringify(l.before?.[k]), b = JSON.stringify(l.after?.[k]);
    if (a !== b) parts.push(`${k}: ${a ?? "—"} ← ${b ?? "—"}`);
  }
  return parts.join(" · ");
}
function describe(r: Record<string, unknown> | null) {
  if (!r) return "";
  return ["name", "full_name", "title", "date", "component", "score", "key"].filter((k) => r[k] !== undefined && r[k] !== null).map((k) => `${k}: ${JSON.stringify(r[k])}`).join(" · ");
}

export default function AuditPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [table, setTable] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    let q = supabase().from("audit_log").select("*").order("at", { ascending: false }).range(page * 100, page * 100 + 99);
    if (table) q = q.eq("table_name", table);
    q.then(({ data }) => setLogs((data ?? []) as Log[]));
  }, [table, page]);

  async function revert(l: Log) {
    if (!confirmAction("استرجاع الحالة السابقة لهذا السجل؟")) return;
    const sb = supabase();
    let error;
    if (l.action === "INSERT") ({ error } = await sb.from(l.table_name).delete().eq("id", l.row_id));
    else if (l.before) {
      const { owner_id: _o, ...rest } = l.before; void _o;
      const conflict = l.table_name === "settings" ? "owner_id,key" : "id";
      ({ error } = await sb.from(l.table_name).upsert(l.table_name === "settings" ? l.before : rest, { onConflict: conflict }));
    }
    toast(error ? { text: error.message, kind: "err" } : { text: "تم الاسترجاع", kind: "ok" });
  }

  return (
    <div>
      <PageHeader info="كل إضافة أو تعديل أو حذف يُسجَّل تلقائياً مع القيمة قبل وبعد. «استرجاع» يعيد السجل إلى حالته قبل هذا التغيير." title="سجل التعديلات" sub="كل تغيير يُسجَّل: ماذا تغيّر، القيمة قبل وبعد، والوقت"
        actions={
          <Select value={table} onChange={(e) => { setTable(e.target.value); setPage(0); }}>
            <option value="">الكل</option>
            {Object.entries(TABLE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        } />
      {!logs ? <Spinner /> : logs.length === 0 ? <Empty>لا توجد تعديلات.</Empty> : (
        <Card className="divide-y divide-zinc-100 p-0 text-sm dark:divide-zinc-800">
          {logs.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="w-36 text-xs text-zinc-500">{new Date(l.at).toLocaleString("ar-LB")}</span>
              <span className="w-24 text-xs"><b>{ACTION_AR[l.action]}</b> {TABLE_AR[l.table_name] ?? l.table_name}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400" dir="ltr" title={diff(l)}>{diff(l)}</span>
              <Button size="sm" variant="ghost" onClick={() => revert(l)}>استرجاع</Button>
            </div>
          ))}
        </Card>
      )}
      <div className="mt-3 flex justify-center gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>الأحدث</Button>
        <Button size="sm" variant="secondary" disabled={(logs?.length ?? 0) < 100} onClick={() => setPage(page + 1)}>الأقدم</Button>
      </div>
    </div>
  );
}
