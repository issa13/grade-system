"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { GradeGrid } from "@/components/grade-grid";
import { SessionsTab } from "@/components/sessions-tab";
import { AssignmentsTab } from "@/components/assignments-tab";
import { SubjectStatsView } from "@/components/stats-views";
import { Empty, LoadError, PageHeader, Spinner, Tabs } from "@/components/ui";
import { must } from "@/lib/class-data";
import { logError } from "@/lib/errors";

type Tab = "grades" | "sessions" | "assignments" | "stats";

export default function SubjectPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const q = useSearchParams();
  const id = q.get("id") ?? "";
  return <SubjectPageView key={id} id={id} tabParam={q.get("tab") as Tab | null} />;
}

function SubjectPageView({ id, tabParam }: { id: string; tabParam: Tab | null }) {
  const [tab, setTab] = useState<Tab>(tabParam ?? "sessions");
  const [subject, setSubject] = useState<Subject | null | undefined>(undefined);
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!tabParam) try { const t = localStorage.getItem("subjectTab") as Tab | null; if (t) setTab(t); } catch {}
    (async () => {
      try {
        setErr(false);
        const s = must(await supabase().from("subjects").select("*").eq("id", id).maybeSingle()) as Subject | null;
        if (!s) return setSubject(null);
        const [c, st] = await Promise.all([
          supabase().from("classes").select("*").eq("id", s.class_id).maybeSingle(),
          supabase().from("students").select("*").eq("class_id", s.class_id).is("deleted_at", null).eq("active", true).order("sort_order").order("full_name"),
        ]);
        setCls(must(c) as ClassRow);
        setStudents((must(st) ?? []) as Student[]);
        setSubject(s);
      } catch (e) { logError(e); setErr(true); }
    })();
  }, [id, retry, tabParam]);

  function change(t: Tab) {
    setTab(t);
    try { localStorage.setItem("subjectTab", t); } catch {}
  }

  if (err) return <LoadError onRetry={() => setRetry((x) => x + 1)} />;
  if (subject === undefined || (subject && !cls)) return <Spinner />;
  if (!subject || !cls) return <Empty>المادة غير موجودة.</Empty>;

  return (
    <div>
      <div className="no-print mb-2 text-sm text-zinc-500">
        <Link href="/classes" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${cls.id}`} className="hover:underline">{cls.name}</Link> ‹ {subject.name}
      </div>
      <PageHeader info="الحصص: البرنامج الأسبوعي وتسجيل كل حصة. كشف العلامات: إدخال العلامات (والأوزان الخاصة بالمادة). الواجبات: متابعة الواجبات. الإحصائيات: أرقام ورسوم عن المادة." title={<span className="flex items-center gap-2"><span className="h-6 w-1.5 rounded-full" style={{ background: subject.color }} />{subject.name}</span>} sub={`${cls.name} · ${students.length} طالب`} />
      <Tabs<Tab> value={tab} onChange={change} tabs={[
        { id: "sessions", label: "الحصص" },
        { id: "grades", label: "كشف العلامات" },
        { id: "assignments", label: "الواجبات" },
        { id: "stats", label: "الإحصائيات" },
      ]} />
      {tab === "grades" && <GradeGrid subject={subject} className={cls.name} students={students} />}
      {tab === "sessions" && <SessionsTab subject={subject} students={students} />}
      {tab === "assignments" && <AssignmentsTab subject={subject} students={students} />}
      {tab === "stats" && <SubjectStatsView subject={subject} students={students} className={cls.name} />}
    </div>
  );
}
