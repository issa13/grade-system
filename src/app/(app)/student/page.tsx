"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassFull, type SubjectGrades } from "@/lib/class-data";
import { absoluteUrl } from "@/lib/paths";
import { overallTrend, TREND_ARROW, TREND_LABEL, type Dates, type Exam } from "@/lib/trajectory";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { WhatsAppQueue } from "@/components/whatsapp";
import { StudentStatsBody } from "@/components/student-stats";
import { PrintButton, PrintHeader } from "@/components/print";
import { Button, Card, Empty, LoadError, PageHeader, Spinner, cx, useToast } from "@/components/ui";
import { logError } from "@/lib/errors";

export default function StudentPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <StudentView key={id} id={id} />;
}

type Loaded = { student: Student; cls: ClassRow; students: Student[]; subjects: Subject[]; data: Record<string, SubjectGrades>; dates: Record<string, Dates> };

function StudentView({ id }: { id: string }) {
  const { settings, loaded, subjectWeights } = useSettings();
  const toast = useToast();
  const [d, setD] = useState<Loaded | null | undefined>(undefined);
  const [wa, setWa] = useState(false);
  const [err, setErr] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
      setErr(false);
      const { data: st, error } = await supabase().from("students").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!st) return setD(null);
      const full = await loadClassFull(st.class_id, settings, subjectWeights);
      if (!full.cls) return setD(null);
      const { data: ad } = await supabase().from("assessment_dates").select("subject_id,component,date").in("subject_id", full.subjects.map((x) => x.id));
      const dates: Record<string, Dates> = {};
      for (const x of (ad ?? []) as { subject_id: string; component: Exam; date: string }[]) (dates[x.subject_id] ??= {})[x.component] = x.date;
      setD({ student: st as Student, cls: full.cls, students: full.students, subjects: full.subjects, data: full.data, dates });
      } catch (e) { logError(e); setErr(true); }
    })();
  }, [id, loaded, settings, subjectWeights, retry]);

  if (err && !d) return <LoadError onRetry={() => setRetry((x) => x + 1)} />;
  if (d === undefined) return <Spinner />;
  if (d === null) return <Empty>الطالب غير موجود.</Empty>;

  const { student, cls, students, subjects, data, dates } = d;
  const pool = students.some((s) => s.id === student.id) ? students : [...students, student];
  const trend = overallTrend(student.id, subjects.map((sj) => ({ id: sj.id, name: sj.name, weight: Number(sj.weight), entries: data[sj.id]?.entries ?? {}, dates: dates[sj.id] ?? {}, weights: subjectWeights[sj.id] })), settings);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(absoluteUrl(`/s/?t=${student.share_token}`));
      toast({ text: "تم نسخ رابط الطالب", kind: "ok" });
    } catch { toast({ text: "تعذّر النسخ — انسخ الرابط من «الصفحة كما يراها الطالب»", kind: "err" }); }
  }

  return (
    <div>
      <div className="no-print mb-2 text-sm text-zinc-500">
        <Link href="/classes" className="hover:underline">الصفوف</Link> ‹ <Link href={`/class?id=${cls.id}`} className="hover:underline">{cls.name}</Link> ‹ {student.full_name}
      </div>
      <PageHeader title={<>{student.full_name}{trend && <span className={cx("ms-2 text-base font-medium", trend === "up" ? "text-green-700 dark:text-green-400" : trend === "down" ? "text-red-600" : "text-zinc-500")} title={`الاتجاه: ${TREND_LABEL[trend]}`}>{TREND_ARROW[trend]} {TREND_LABEL[trend]}</span>}</>}
        sub={<>{cls.name}{student.student_number && ` · رقم ${student.student_number}`}{!student.active && " · غير فعّال"}</>}
        actions={
          <>
            <PrintButton title={`إحصائيات ${student.full_name}`} />
            <Button variant="secondary" onClick={() => setWa(true)}>رسالة واتساب</Button>
            <Link href={`/report?class=${cls.id}&student=${student.id}`}><Button variant="secondary">التقرير الرسمي</Button></Link>
            {student.share_enabled && <>
              <Button variant="secondary" onClick={copyLink}>نسخ رابط الطالب</Button>
              <a href={absoluteUrl(`/s/?t=${student.share_token}`)} target="_blank" rel="noreferrer"><Button variant="secondary">الصفحة كما يراها الطالب</Button></a>
            </>}
          </>
        } />
      {wa && <WhatsAppQueue students={[student]} classId={cls.id} onClose={() => setWa(false)} />}

      <PrintHeader title={`إحصائيات ${student.full_name}`} sub={cls.name} />
      <StudentStatsBody student={student} pool={pool} subjects={subjects} data={data} dates={dates} weights={subjectWeights} links />
      <div className="mt-4 space-y-4">
        {student.notes && <Card className="no-print"><div className="text-sm"><b>ملاحظات:</b> {student.notes}</div></Card>}
      </div>
    </div>
  );
}

