"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { absoluteUrl } from "@/lib/paths";
import { Suspense, useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadClassBasics, loadSubjectGrades, type SubjectGrades } from "@/lib/class-data";
import { exportCsv, exportXlsx } from "@/lib/excel";
import { compareSheet, gradeSheet, summarySheet } from "@/lib/exports";
import { hasSemester2 } from "@/lib/compare";
import { overallTrend } from "@/lib/trajectory";
import { TrendArrow, useAssessmentDates } from "@/components/trend";
import { bandFor, fmt, overallAverage } from "@/lib/grades";
import type { ClassRow, Student, Subject } from "@/lib/types";
import { useSettings } from "@/components/settings-provider";
import { ImportStudents } from "@/components/import-students";
import { PhoneEntry, WhatsAppQueue } from "@/components/whatsapp";
import { normalizePhone, prettyPhone } from "@/lib/whatsapp";
import { ClassStatsView } from "@/components/stats-views";
import { Info } from "@/components/info";
import { Button, Card, Empty, Field, Input, Modal, PageHeader, Spinner, Tabs, confirmAction, cx, useToast } from "@/components/ui";

type Tab = "students" | "subjects" | "summary" | "stats";

export default function ClassPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const q = useSearchParams();
  const id = q.get("id") ?? "";
  return <ClassPageView key={id} id={id} openPhones={q.get("phones") === "1"} initialTab={(q.get("tab") as Tab) || "students"} />;
}

function ClassPageView({ id, openPhones, initialTab }: { id: string; openPhones: boolean; initialTab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
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
      <div className="mb-2 text-sm text-zinc-500"><Link href="/classes" className="hover:underline">الصفوف</Link> ‹ {cls.name}</div>
      <PageHeader info="الطلاب: إضافة وترتيب ومشاركة الروابط والأرقام. المواد: كل مادة لها حصص وكشف علامات. ملخص العلامات: النهائي والمعدل العام لكل طالب. الإحصائيات: أرقام ورسوم عن الصف." title={cls.name} sub={`${cls.school_year ?? ""} · ${students.filter((s) => s.active).length} طالب · ${subjects.length} مادة`}
        actions={<Link href={`/report?class=${cls.id}`}><Button variant="secondary">تقارير PDF</Button></Link>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "students", label: "الطلاب" },
        { id: "subjects", label: "المواد" },
        { id: "summary", label: "ملخص العلامات" },
        { id: "stats", label: "الإحصائيات" },
      ]} />
      {tab === "students" && <StudentsTab cls={cls} students={students} reload={load} openPhones={openPhones} />}
      {tab === "subjects" && <SubjectsTab classId={cls.id} subjects={subjects} reload={load} />}
      {tab === "summary" && <SummaryTab cls={cls} students={students.filter((s) => s.active)} subjects={subjects} />}
      {tab === "stats" && <ClassStatsView cls={cls} students={students.filter((s) => s.active)} subjects={subjects} />}
    </div>
  );
}

// ======================= الطلاب =======================
function StudentsTab({ cls, students, reload, openPhones }: { cls: ClassRow; students: Student[]; reload: () => void; openPhones?: boolean }) {
  const toast = useToast();
  const { settings } = useSettings();
  const cc = settings.whatsapp.country_code;
  const [phonesOpen, setPhonesOpen] = useState(!!openPhones);
  const [wa, setWa] = useState<Student[] | null>(null);
  const [sentToday, setSentToday] = useState<Set<string>>(new Set());
  useEffect(() => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    supabase().from("message_log").select("student_id").gte("sent_at", since.toISOString())
      .then(({ data }) => setSentToday(new Set((data ?? []).map((x: { student_id: string }) => x.student_id))));
  }, [wa]);
  const [edit, setEdit] = useState<Partial<Student> | null>(null);
  const [bulk, setBulk] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [move, setMove] = useState<Student | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [filter, setFilter] = useState("");
  // ترتيب الطلاب (سحب وإفلات)
  const [order, setOrder] = useState<Student[]>(students);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  useEffect(() => { setOrder(students); }, [students]);

  async function persistOrder(next: Student[], prev: Student[], msg = "تم حفظ الترتيب") {
    setOrder(next);
    const changed = next.map((st, i) => ({ st, i: i + 1 })).filter(({ st, i }) => st.sort_order !== i);
    if (!changed.length) return;
    const results = await Promise.all(changed.map(({ st, i }) => supabase().from("students").update({ sort_order: i }).eq("id", st.id)));
    const err = results.find((x) => x.error)?.error;
    if (err) { toast({ text: err.message, kind: "err" }); setOrder(prev); return; }
    toast({ text: msg, kind: "ok", action: { label: "تراجع", run: async () => {
      await Promise.all(prev.map((st, i) => supabase().from("students").update({ sort_order: i + 1 }).eq("id", st.id)));
      reload();
    } } });
    reload();
  }
  function moveTo(fromId: string, toId: string) {
    const from = order.findIndex((x) => x.id === fromId), to = order.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...order];
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    persistOrder(next, order);
  }
  function step(st: Student, d: -1 | 1) {
    const i = order.findIndex((x) => x.id === st.id);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    moveTo(st.id, order[j].id);
  }
  function sortAlpha() {
    if (!confirmAction("ترتيب الطلاب أبجدياً؟ (يمكن التراجع)")) return;
    persistOrder([...order].sort((a, b) => a.full_name.localeCompare(b.full_name, "ar")), order, "رُتّب الطلاب أبجدياً");
  }

  useEffect(() => {
    supabase().from("classes").select("*").is("deleted_at", null).neq("id", cls.id).then(({ data }) => setClasses((data ?? []) as ClassRow[]));
  }, [cls.id]);

  const link = (s: Student) => absoluteUrl(`/s/?t=${s.share_token}`);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!edit?.full_name) return;
    const rawPhone = (edit.phone ?? "").trim();
    const phone = rawPhone ? normalizePhone(rawPhone, cc) : null;
    if (rawPhone && !phone) return toast({ text: "رقم الهاتف غير صالح", kind: "err" });
    const payload = { full_name: edit.full_name.trim(), student_number: edit.student_number || null, notes: edit.notes || null, phone };
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

  const shown = order.filter((s) => !filter || s.full_name.includes(filter));
  const canDrag = !filter;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="بحث عن طالب…" value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-xs" />
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => setWa(students.filter((s) => s.active))} disabled={!students.length}>رسائل الصف</Button>
        <Button variant="secondary" onClick={() => setPhonesOpen(true)} disabled={!students.length}>إدخال الأرقام{students.some((s) => s.pending_phone) ? ` (${students.filter((s) => s.pending_phone).length} بانتظار الموافقة)` : ""}</Button>
        <Button variant="secondary" onClick={sortAlpha} disabled={students.length < 2}>ترتيب أبجدي</Button>
        <Button variant="secondary" onClick={exportList}>تصدير القائمة</Button>
        <Button variant="secondary" onClick={() => setImportOpen(true)}>استيراد Excel</Button>
        <Button variant="secondary" onClick={() => setBulk("")}>لصق أسماء</Button>
        <Button onClick={() => setEdit({})}>+ طالب</Button>
      </div>

      {students.length === 0 ? <Empty>لا يوجد طلاب. أضف طالباً أو استورد ملف Excel.</Empty> : (
        <Card className="table-scroll p-0">
          <table className="sheet w-full text-sm [--c1w:3.5rem]">
            <thead>
              <tr>
                <th className="sticky-c1 p-3 text-right font-medium">#<Info title="ترتيب الطلاب">اسحب الطالب من المقبض ⠿ وأفلته في المكان الذي تريده، أو استعمل السهمين ▲▼. هذا الترتيب يُستعمل في كشف العلامات وتسجيل الحصص والتصدير. السحب متوقف أثناء البحث.</Info></th>
                <th className="sticky-c2 p-3 text-right font-medium">الاسم<Info title="صفحة الطالب">اضغط على اسم الطالب لرؤية إحصائياته: معدله، ترتيبه، حضوره وسلوكه في كل مادة.</Info></th>
                <th className="p-3 text-right font-medium">الرقم</th>
                <th className="p-3 text-right font-medium">الهاتف<Info title="رقم الطالب">لرسائل واتساب (للطالب فقط). «إدخال الأرقام» لإدخالها بسرعة، أو يرسل الطالب رقمه من صفحة علاماته ويظهر هنا للموافقة.</Info></th>
                <th className="p-3 text-right font-medium">رابط العلامات<Info title="رابط العلامات">لكل طالب رابط خاص يرى فيه علاماته فقط ويتحدّث مباشرة. «تجديد» يُنشئ رابطاً جديداً ويوقف القديم، «تعطيل» يوقف الرابط مؤقتاً. لا يحتاج الطالب إلى حساب.</Info></th>
                <th className="p-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={s.id}
                  draggable={canDrag && dragId !== null}
                  onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.id); }}
                  onDragOver={(e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (overId !== s.id) setOverId(s.id); }}
                  onDrop={(e) => { e.preventDefault(); if (dragId) moveTo(dragId, s.id); setDragId(null); setOverId(null); }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  className={cx(!s.active && "text-zinc-400", dragId === s.id && "opacity-40", overId === s.id && dragId !== s.id && "[&>td]:!bg-brand-50 dark:[&>td]:!bg-brand-700/30")}>
                  <td className="sticky-c1 p-1 text-zinc-400">
                    <div className="flex items-center gap-0.5">
                      {canDrag && (
                        <span
                          className="cursor-grab touch-none select-none px-0.5 text-base text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
                          title="اسحب لتغيير الترتيب"
                          onMouseDown={() => setDragId(s.id)}
                          onMouseUp={() => setDragId(null)}
                        >⠿</span>
                      )}
                      <span className="tabular-nums">{i + 1}</span>
                    </div>
                  </td>
                  <td className="sticky-c2 whitespace-nowrap p-3 font-medium">
                    {canDrag && (
                      <span className="me-2 inline-flex flex-col align-middle text-[9px] leading-none text-zinc-400">
                        <button aria-label="تحريك للأعلى" className="hover:text-zinc-800 disabled:opacity-30" disabled={i === 0} onClick={() => step(s, -1)}>▲</button>
                        <button aria-label="تحريك للأسفل" className="hover:text-zinc-800 disabled:opacity-30" disabled={i === shown.length - 1} onClick={() => step(s, 1)}>▼</button>
                      </span>
                    )}
                    <Link href={`/student?id=${s.id}`} className="hover:text-brand-600 hover:underline">{s.full_name}</Link>{!s.active && <span className="ms-2 text-xs text-zinc-500">(غير فعّال)</span>}</td>
                  <td className="p-3">{s.student_number}</td>
                  <td className="whitespace-nowrap p-3">
                    {s.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <span dir="ltr" className="text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{prettyPhone(s.phone, cc)}</span>
                        <button className="rounded px-1.5 py-0.5 text-xs text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-zinc-800" onClick={() => setWa([s])} title="رسالة واتساب">واتساب</button>
                        {sentToday.has(s.id) && <span className="text-[10px] text-green-600">أُرسلت اليوم</span>}
                      </span>
                    ) : s.pending_phone ? (
                      <button className="text-xs text-amber-700 hover:underline dark:text-amber-400" onClick={() => setPhonesOpen(true)}>رقم بانتظار الموافقة</button>
                    ) : <button className="text-xs text-zinc-400 hover:underline" onClick={() => setPhonesOpen(true)}>أضف رقماً</button>}
                  </td>
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
          <Field label="هاتف الطالب (واتساب)" info="يُقبل بأي شكل: 03 123 456 أو ‎+961 3 123456. للطالب فقط، لا يظهر في صفحته."><Input dir="ltr" inputMode="tel" placeholder="03 123 456" value={edit?.phone ?? ""} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="ملاحظات" info="ملاحظة خاصة بك، لا تظهر للطالب. تظهر في صفحة إحصائيات الطالب."><Input value={edit?.notes ?? ""} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
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

      {phonesOpen && <PhoneEntry students={students.filter((s) => s.active)} onClose={() => setPhonesOpen(false)} onSaved={reload} />}
      {wa && <WhatsAppQueue students={wa} classId={cls.id} onClose={() => setWa(null)} />}
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
            <Field label="الوزن في المعدل العام" info="المعدل العام = معدل علامات المواد حسب الوزن. مادة وزنها 2 تُحسب ضعف مادة وزنها 1."><Input type="number" step="0.1" min="0" value={edit?.weight ?? 1} onChange={(e) => setEdit({ ...edit, weight: Number(e.target.value) })} /></Field>
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
  const { settings, loaded, subjectWeights } = useSettings();
  const [grades, setGrades] = useState<Record<string, SubjectGrades> | null>(null);
  const dates = useAssessmentDates(subjects);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      const out: Record<string, SubjectGrades> = {};
      await Promise.all(subjects.map(async (s) => { out[s.id] = await loadSubjectGrades(s.id, students, settings, subjectWeights[s.id]); }));
      setGrades(out);
    })();
  }, [subjects, students, settings, loaded, subjectWeights]);

  if (!grades) return <Spinner />;
  if (!subjects.length) return <Empty>أضف مواد أولاً.</Empty>;

  const overall = (st: Student) =>
    overallAverage(subjects.map((sj) => ({ final: grades[sj.id]?.rows[st.id]?.final ?? null, weight: Number(sj.weight) })), settings);

  async function exportAll(kind: "xlsx" | "csv") {
    const sum = summarySheet(cls.name, students, subjects, grades!, settings);
    if (kind === "csv") return exportCsv(sum.header, sum.rows, `ملخص ${cls.name}.csv`);
    const extra = hasSemester2(subjects, grades!) ? [compareSheet(cls.name, students, subjects, grades!, settings)] : [];
    await exportXlsx([sum, ...extra, ...subjects.map((s) => gradeSheet(s, cls.name, students, grades![s.id], settings))], `علامات ${cls.name}.xlsx`);
  }

  const passed = students.filter((s) => { const o = overall(s); return typeof o === "number" && o >= settings.grading.pass_mark; }).length;
  const trendIn = subjects.map((sj) => ({ id: sj.id, name: sj.name, weight: Number(sj.weight), entries: grades[sj.id]?.entries ?? {}, dates: dates[sj.id] ?? {}, weights: subjectWeights[sj.id] }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-zinc-500">ناجح: <b className="text-zinc-900 dark:text-zinc-100">{passed}</b> من {students.length} (علامة النجاح {settings.grading.pass_mark}/{settings.grading.scale})</span>
        <div className="flex-1" />
        <Button variant="secondary" onClick={() => exportAll("csv")}>تصدير CSV</Button>
        <Button onClick={() => exportAll("xlsx")}>تصدير Excel (كل المواد)</Button>
      </div>
      <Card className="table-scroll p-0">
        <table className="sheet w-full text-sm">
          <thead>
            <tr>
              <th className="sticky-c1">#</th><th className="sticky-c2 text-right">الاسم</th>
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
                  <td className="sticky-c1 px-2 text-center text-zinc-400">{i + 1}</td>
                  <td className="sticky-c2 whitespace-nowrap px-2 py-1.5"><Link href={`/student?id=${st.id}`} className="hover:text-brand-600 hover:underline">{st.full_name}</Link>{(() => { const t = overallTrend(st.id, trendIn, settings); return t ? <TrendArrow t={t} /> : null; })()}</td>
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

