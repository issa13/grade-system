"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { absoluteUrl } from "@/lib/paths";
import { Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassBasics, loadSubjectGrades, type SubjectGrades } from "@/lib/class-data";
import { exportCsv, exportXlsx } from "@/lib/excel";
import { gradeSheet, summarySheet } from "@/lib/exports";
import { bandFor, fmt, overallAverage } from "@/lib/grades";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { ImportStudents } from "@/components/import-students";
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Tabs, confirmAction, cx, useToast } from "@/components/ui";

type Tab = "students" | "subjects" | "summary";

export default function ClassPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const id = useSearchParams().get("id") ?? "";
  return <ClassPageView key={id} id={id} />;
}

function ClassPageView({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>("students");
  const [cls, setCls] = useState<ClassRow | null>(null);
  const [students, setStudents] = useState<Student[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);

  const load = useCallback(async () => {
    const d = await loadClassBasics(id);
    setCls(d.cls);
    setStudents(d.students);
    setSubjects(d.subjects);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!students) return <Spinner />;
  if (!cls) return <Empty>الصف غير موجود.</Empty>;

  return (
    <div>
      <div className="mb-2 text-sm text-zinc-500"><Link href="/" className="hover:underline">الصفوف</Link> ‹ {cls.name}</div>
      <PageHeader title={cls.name} sub={`${cls.school_year ?? ""} · ${students.filter((s) => s.active).length} طالب · ${subjects.length} مادة`} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "students", label: "الطلاب" },
        { id: "subjects", label: "المواد" },
        { id: "summary", label: "ملخص العلامات" },
      ]} />
      {tab === "students" && <StudentsTab cls={cls} students={students} reload={load} />}
      {tab === "subjects" && <SubjectsTab classId={cls.id} subjects={subjects} reload={load} />}
      {tab === "summary" && <SummaryTab cls={cls} students={students.filter((s) => s.active)} subjects={subjects} />}
    </div>
  );
}

// ======================= الطلاب =======================
function StudentsTab({ cls, students, reload }: { cls: ClassRow; students: Student[]; reload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Student> | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [move, setMove] = useState<Student | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    supabase().from("classes").select("*").is("deleted_at", null).neq("id", cls.id).then(({ data }) => setClasses((data ?? []) as ClassRow[]));
  }, [cls.id]);

  const link = (s: Student) => absoluteUrl(`/s/?t=${s.share_token}`);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit?.full_name) return;
    const payload = { full_name: edit.full_name.trim(), student_number: edit.student_number || null, notes: edit.notes || null };
    const { error } = edit.id
      ? await supabase().from("students").update(payload).eq("id", edit.id)
      : await supabase().from("students").insert({ ...payload, class_id: cls.id, sort_order: students.length + 1 });
    if (error) return toast({ text: error.message, kind: "err" });
    setEdit(null);
    reload();
  }

  async function saveBulk() {
    const names = (bulk ?? "").split("\n").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!names.length) return;
    const { error } = await supabase().from("students").insert(
      names.map((n, i) => ({ class_id: cls.id, full_name: n, sort_order: students.length + i + 1 })),
    );
    if (error) return toast({ text: error.message, kind: "err" });
    toast({ text: `أُضيف ${names.length} طالب`, kind: "ok" });
    setBulk(null);
    reload();
  }

  async function update(s: Student, patch: Partial<Student>, msg?: string) {
    const { error } = await supabase().from("students").update(patch).eq("id", s.id);
    if (error) return toast({ text: error.message, kind: "err" });
    if (msg) toast({ text: msg, kind: "ok" });
    reload();
  }

  async function remove(s: Student) {
    await update(s, { deleted_at: new Date().toISOString() });
    toast({ text: `حُذف ${s.full_name}`, kind: "ok", action: { label: "تراجع", run: () => update(s, { deleted_at: null }) } });
  }

  async function copy(s: Student) {
    await navigator.clipboard.writeText(link(s));
    toast({ text: "تم نسخ الرابط", kind: "ok" });
  }

  async function exportList() {
    await exportXlsx([{
      name: "الطلاب", title: cls.name, header: ["الرقم", "الاسم", "رقم الطالب", "الحالة", "ملاحظات", "رابط العلامات"],
      rows: students.map((s, i) => [i + 1, s.full_name, s.student_number, s.active ? "فعّال" : "غير فعّال", s.notes, s.share_enabled ? link(s) : ""]),
      widths: [7, 32, 12, 10, 25, 60],
    }], `طلاب ${cls.name}.xlsx`);
  }

  const shown = students.filter((s) => !filter || s.full_name.includes(filter));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="بحث عن طالب…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        <div className="flex-1" />
        <Button variant="secondary" onClick={exportList}>تصدير القائمة</Button>
        <Button variant="secondary" onClick={() => setImportOpen(true)}>استيراد Excel</Button>
        <Button variant="secondary" onClick={() => setBulk("")}>لصق أسماء</Button>
        <Button onClick={() => setEdit({})}>+ طالب</Button>
      </div>

      {students.length === 0 ? <Empty>لا يوجد طلاب. أضف طالباً أو استورد ملف Excel.</Empty> : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/50">
              <tr>
                <th className="p-3 text-right font-medium">#</th>
                <th className="p-3 text-right font-medium">الاسم</th>
                <th className="p-3 text-right font-medium">الرقم</th>
                <th className="p-3 text-right font-medium">رابط العلامات</th>
                <th className="p-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={s.id} className={cx("border-t border-zinc-100 dark:border-zinc-800", !s.active && "opacity-50")}>
                  <td className="p-3 text-zinc-400">{i + 1}</td>
                  <td className="p-3 font-medium">{s.full_name}{!s.active && <span className="ms-2 text-xs text-zinc-500">(غير فعّال)</span>}</td>
                  <td className="p-3">{s.student_number}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {s.share_enabled ? (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => copy(s)}>نسخ</Button>
                          <a href={link(s)} target="_blank" rel="noreferrer" className="rounded-lg px-2.5 py-1 text-sm text-brand-600 hover:bg-brand-50 dark:hover:bg-zinc-800">فتح</a>
                          <Button size="sm" variant="ghost" onClick={() => confirmAction("سيتوقف الرابط القديم عن العمل. متابعة؟") && update(s, { share_token: crypto.randomUUID() }, "تم إنشاء رابط جديد")}>تجديد</Button>
                          <Button size="sm" variant="ghost" onClick={() => update(s, { share_enabled: false }, "تم تعطيل الرابط")}>تعطيل</Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => update(s, { share_enabled: true }, "تم تفعيل الرابط")}>تفعيل الرابط</Button>
                      )}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>تعديل</Button>
                      <Button size="sm" variant="ghost" onClick={() => setMove(s)}>نقل</Button>
                      <Button size="sm" variant="ghost" onClick={() => update(s, { active: !s.active })}>{s.active ? "إيقاف" : "تفعيل"}</Button>
                      <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(s)}>حذف</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "تعديل الطالب" : "طالب جديد"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="الاسم الكامل"><Input autoFocus required value={edit?.full_name ?? ""} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
          <Field label="رقم الطالب (اختياري)"><Input value={edit?.student_number ?? ""} onChange={(e) => setEdit({ ...edit, student_number: e.target.value })} /></Field>
          <Field label="ملاحظات"><Input value={edit?.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button>
            <Button>حفظ</Button>
          </div>
        </form>
      </Modal>

      <Modal open={bulk !== null} onClose={() => setBulk(null)} title="لصق أسماء الطلاب">
        <p className="mb-2 text-sm text-zinc-500">اسم واحد في كل سطر.</p>
        <textarea autoFocus rows={10} value={bulk ?? ""} onChange={(e) => setBulk(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setBulk(null)}>إلغاء</Button>
          <Button onClick={saveBulk}>إضافة</Button>
        </div>
      </Modal>

      <Modal open={!!move} onClose={() => setMove(null)} title={`نقل ${move?.full_name ?? ""}`}>
        {classes.length === 0 ? <p className="text-sm text-zinc-500">لا يوجد صف آخر.</p> : (
          <div className="space-y-2">
            {classes.map((c) => (
              <Button key={c.id} variant="secondary" className="w-full justify-start" onClick={async () => {
                await update(move!, { class_id: c.id }, `نُقل إلى ${c.name}`);
                setMove(null);
              }}>{c.name}</Button>
            ))}
            <p className="pt-2 text-xs text-zinc-500">ملاحظة: علامات الطالب مرتبطة بمواد الصف الحالي، لذلك لن تظهر في الصف الجديد.</p>
          </div>
        )}
      </Modal>

      <ImportStudents open={importOpen} onClose={() => setImportOpen(false)} classId={cls.id} existing={students} onDone={reload} />
    </div>
  );
}

// ======================= المواد =======================
function SubjectsTab({ classId, subjects, reload }: { classId: string; subjects: Subject[]; reload: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Partial<Subject> | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit?.name) return;
    const payload = { name: edit.name, color: edit.color || "#1f7a68", weight: Number(edit.weight ?? 1) || 1 };
    const { error } = edit.id
      ? await supabase().from("subjects").update(payload).eq("id", edit.id)
      : await supabase().from("subjects").insert({ ...payload, class_id: classId });
    if (error) return toast({ text: error.message, kind: "err" });
    setEdit(null);
    reload();
  }
  async function remove(s: Subject) {
    await supabase().from("subjects").update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    toast({ text: `حُذفت ${s.name}`, kind: "ok", action: { label: "تراجع", run: async () => { await supabase().from("subjects").update({ deleted_at: null }).eq("id", s.id); reload(); } } });
    reload();
  }

  return (
    <div>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEdit({ weight: 1, color: "#1f7a68" })}>+ مادة</Button></div>
      {subjects.length === 0 ? <Empty>لا توجد مواد. أضف مادة لتبدأ بتسجيل الحصص والعلامات.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s) => (
            <Card key={s.id} className="flex items-center gap-3">
              <span className="h-10 w-1.5 rounded-full" style={{ background: s.color }} />
              <Link href={`/subject?id=${s.id}`} className="flex-1 hover:text-brand-600">
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-zinc-500">الوزن في المعدل العام: {s.weight}</div>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setEdit(s)}>تعديل</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(s)}>حذف</Button>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "تعديل المادة" : "مادة جديدة"}>
        <form onSubmit={save} className="space-y-3">
          <Field label="اسم المادة"><Input autoFocus required value={edit?.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="اللون"><Input type="color" className="h-10 p-1" value={edit?.color ?? "#1f7a68"} onChange={(e) => setEdit({ ...edit, color: e.target.value })} /></Field>
            <Field label="الوزن في المعدل العام"><Input type="number" step="0.1" min="0" value={edit?.weight ?? 1} onChange={(e) => setEdit({ ...edit, weight: Number(e.target.value) })} /></Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEdit(null)}>إلغاء</Button>
            <Button>حفظ</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ======================= الملخص =======================
function SummaryTab({ cls, students, subjects }: { cls: ClassRow; students: Student[]; subjects: Subject[] }) {
  const { settings, loaded } = useSettings();
  const [grades, setGrades] = useState<Record<string, SubjectGrades> | null>(null);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const out: Record<string, SubjectGrades> = {};
      await Promise.all(subjects.map(async (s) => { out[s.id] = await loadSubjectGrades(s.id, students, settings); }));
      setGrades(out);
    })();
  }, [subjects, students, settings, loaded]);

  if (!grades) return <Spinner />;
  if (!subjects.length) return <Empty>أضف مواد أولاً.</Empty>;

  const overall = (st: Student) =>
    overallAverage(subjects.map((sj) => ({ final: grades[sj.id]?.rows[st.id]?.final ?? null, weight: Number(sj.weight) })), settings);

  async function exportAll(kind: "xlsx" | "csv") {
    const sum = summarySheet(cls.name, students, subjects, grades!, settings);
    if (kind === "csv") return exportCsv(sum.header, sum.rows, `ملخص ${cls.name}.csv`);
    await exportXlsx([sum, ...subjects.map((s) => gradeSheet(s, cls.name, students, grades![s.id], settings))], `علامات ${cls.name}.xlsx`);
  }

  const passed = students.filter((s) => { const o = overall(s); return typeof o === "number" && o >= settings.grading.pass_mark; }).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">ناجح: <b className="text-zinc-900 dark:text-zinc-100">{passed}</b> من {students.length} (علامة النجاح {settings.grading.pass_mark}/{settings.grading.scale})</span>
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => exportAll("csv")}>تصدير CSV</Button>
        <Button onClick={() => exportAll("xlsx")}>تصدير Excel (كل المواد)</Button>
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="sheet w-full border-collapse text-sm">
          <thead>
            <tr>
              <th>#</th><th className="text-right">الاسم</th>
              {subjects.map((s) => <th key={s.id}><Link href={`/subject?id=${s.id}`} className="hover:underline">{s.name}</Link></th>)}
              <th>المعدل العام</th><th>التقدير</th>
            </tr>
          </thead>
          <tbody>
            {students.map((st, i) => {
              const o = overall(st);
              const b = bandFor(o, settings);
              return (
                <tr key={st.id}>
                  <td className="px-2 text-center text-zinc-400">{i + 1}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{st.full_name}</td>
                  {subjects.map((s) => {
                    const f = grades[s.id]?.rows[st.id]?.final ?? null;
                    return <td key={s.id} className={cx("px-2 text-center tabular-nums", typeof f === "number" && f < settings.grading.pass_mark && "text-red-600")}>{fmt(f)}</td>;
                  })}
                  <td className="px-2 text-center font-semibold tabular-nums">{fmt(o)}</td>
                  <td className="px-2 text-center" style={{ color: b?.color }}>{b?.label}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <SelectHint />
    </div>
  );
}

function SelectHint() {
  return <p className="mt-3 text-xs text-zinc-500">NC = غير مكتمل (توجد علامة ناقصة). يمكن تغيير هذا السلوك من الإعدادات ← حساب العلامات.</p>;
}

