"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSettings } from "@/components/settings-provider";
import { Button, Card, Empty, PageHeader, Spinner, confirmAction, useToast } from "@/components/ui";

const TABLES = [
  { t: "classes", label: "صف", name: (r: Row) => r.name },
  { t: "students", label: "طالب", name: (r: Row) => r.full_name },
  { t: "subjects", label: "مادة", name: (r: Row) => r.name },
  { t: "sessions", label: "حصة", name: (r: Row) => r.date },
  { t: "assignments", label: "واجب", name: (r: Row) => r.title },
] as const;

type Row = { id: string; deleted_at: string; name?: string; full_name?: string; date?: string; title?: string };
type Item = Row & { table: string; label: string; display: string };

export default function TrashPage() {
  const { settings } = useSettings();
  const toast = useToast();
  const [items, setItems] = useState<Item[] | null>(null);

  const load = useCallback(async () => {
    const all: Item[] = [];
    for (const x of TABLES) {
      const { data } = await supabase().from(x.t).select("*").not("deleted_at", "is", null);
      (data ?? []).forEach((r: Row) => all.push({ ...r, table: x.t, label: x.label, display: x.name(r) ?? "" }));
    }
    all.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
    setItems(all);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function restore(i: Item) {
    await supabase().from(i.table).update({ deleted_at: null }).eq("id", i.id);
    toast({ text: "تمت الاستعادة", kind: "ok" });
    load();
  }
  async function purge(i: Item) {
    if (!confirmAction("حذف نهائي؟ لا يمكن التراجع.")) return;
    await supabase().from(i.table).delete().eq("id", i.id);
    load();
  }

  return (
    <div>
      <PageHeader info="كل ما تحذفه يأتي إلى هنا أولاً. «استعادة» ترجعه كما كان مع كل بياناته. المدة تُعدَّل من الإعدادات ← البيانات." title="سلة المحذوفات" sub={`تُحذف العناصر نهائياً بعد ${settings.data.trash_retention_days} يوماً`} />
      {!items ? <Spinner /> : items.length === 0 ? <Empty>السلة فارغة.</Empty> : (
        <Card className="divide-y divide-zinc-100 p-0 dark:divide-zinc-800">
          {items.map((i) => (
            <div key={i.table + i.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-14 rounded bg-zinc-100 px-2 py-0.5 text-center text-xs dark:bg-zinc-800">{i.label}</span>
              <span className="flex-1">{i.display}</span>
              <span className="text-xs text-zinc-500">{new Date(i.deleted_at).toLocaleString("ar-LB")}</span>
              <Button size="sm" variant="secondary" onClick={() => restore(i)}>استعادة</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => purge(i)}>حذف نهائي</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
