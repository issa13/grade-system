"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { GradeGrid } from "@/components/grade-grid";
import { SessionsTab } from "@/components/sessions-tab";
import { AssignmentsTab } from "@/components/assignments-tab";
import { Empty, PageHeader, Spinner, Tabs } from "@/components/ui";

type Tab = "grades" | "sessions" | "assignments";

export default function SubjectPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <SubjectPageView key={id} id={id} />;
}

function SubjectPageView({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>("sessions");
  const [subject, setSubject] = useState<Subject | null | undefined>(undefined);
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    try { const t = localStorage.getItem("subjectTab") as Tab | null; if (t) setTab(t); } catch {}
    (async () => {
      const { data: s } = await supabase().from("subjects").select("*").eq("id", id).single();
      setSubject((s as Subject) ?? null);
      if (!s) return;
      const [c, st] = await Promise.all([
        supabase().from("classes").select("*").eq("id", s.class_id).single(),
        supabase().from("students").select("*").eq("class_id", s.class_id).is("deleted_at", null).eq("active", true).order("sort_order").order("full_name"),
      ]);
      setCls(c.data as ClassRow);
      setStudents((st.data ?? []) as Student[]);
    })();
  }, [id]);

  function change(t: Tab) {
    setTab(t);
    try { localStorage.setItem("subjectTab", t); } catch {}
  }

  if (subject === undefined || (subject && !cls)) return <Spinner />;
  if (!subject || !cls) return <Empty>المادة غير موجودة.</Empty>;

  return (
    <div>
      <div className="mb-2 text-sm text-zinc-500">
        <Link href="/" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${cls.id}`} className="hover:underline">{cls.name}</Link> ‹ {subject.name}
      </div>
      <PageHeader title={<span className="flex items-center gap-2"><span className="h-6 w-1.5 rounded-full" style={{ background: subject.color }} />{subject.name}</span>} sub={`${cls.name} · ${students.length} طالب`} />
      <Tabs<Tab> value={tab} onChange={change} tabs={[
        { id: "sessions", label: "الحصص" },
        { id: "grades", label: "كشف العلامات" },
        { id: "assignments", label: "الواجبات" },
      ]} />
      {tab === "grades" && <GradeGrid subject={subject} className={cls.name} students={students} />}
      {tab === "sessions" && <SessionsTab subject={subject} students={students} />}
      {tab === "assignments" && <AssignmentsTab subject={subject} students={students} />}
    </div>
  );
}
