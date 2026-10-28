// النسخة الاحتياطية الأسبوعية — تعمل على GitHub Actions (.github/workflows/backup.yml)
// تقرأ كل الجداول من Supabase، تبني ملف Excel بكل العلامات + ملف JSON للاسترجاع،
// وترسلهما بالإيميل عبر Gmail. تُشغّل بـ: npx tsx scripts/backup.mjs
//
// المستودع عام: لا يُطبع أي اسم أو علامة في السجل (فقط أعداد)، ولا يُحفظ أي ملف في المستودع.

import { createClient } from "@supabase/supabase-js";
import writeXlsxFile from "write-excel-file/node";
import nodemailer from "nodemailer";
import { BACKUP_TABLES, BACKUP_VERSION } from "../src/lib/backup-tables.ts";
import { aggregate } from "../src/lib/behavior.ts";
import { computeRow } from "../src/lib/grades.ts";
import { effectiveSettings, mergeSettings } from "../src/lib/settings.ts";
import { compareSheet, gradeSheet, summarySheet } from "../src/lib/exports.ts";
import { hasSemester2 } from "../src/lib/compare.ts";
import { toXlsxSheets } from "../src/lib/xlsx-sheets.ts";
import { computeAlerts, groupAlerts, visibleAlerts } from "../src/lib/alerts.ts";
import { addDays } from "../src/lib/schedule.ts";

const env = (k, ...alt) => { for (const n of [k, ...alt]) if (process.env[n]) return process.env[n]; return ""; };
const URL_ = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const SMTP_USER = env("SMTP_USER");
const SMTP_PASS = env("SMTP_PASS");
const TO = env("BACKUP_TO") || SMTP_USER;
const DRY = process.argv.includes("--dry-run"); // يبني الملفين في مجلد مؤقت بدون إرسال (للتجربة على الجهاز)

for (const [k, v] of Object.entries({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: KEY, ...(DRY ? {} : { SMTP_USER, SMTP_PASS }) })) {
  if (!v) { console.error(`ينقص السر ${k} (Settings ← Secrets and variables ← Actions)`); process.exit(1); }
}

const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function all(table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const todayISO = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // توقيت بيروت تقريباً
const tables = {};
for (const t of BACKUP_TABLES) {
  tables[t] = await all(t);
  console.log(`${t}: ${tables[t].length} سطر`);
}

// ---------- الإعدادات لكل أستاذ (حساب) ----------
const settingsOf = new Map();
const weightsOf = new Map();
for (const owner of new Set(tables.settings.map((r) => r.owner_id).concat(tables.classes.map((c) => c.owner_id)))) {
  const rows = tables.settings.filter((r) => r.owner_id === owner);
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  settingsOf.set(owner, mergeSettings(obj));
  const w = {};
  for (const r of rows) if (r.key.startsWith("subject:")) w[r.key.slice(8)] = r.value;
  weightsOf.set(owner, w);
}

// ---------- ملف Excel ----------
const sheets = [];
const classes = tables.classes.filter((c) => !c.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
const liveSessions = tables.sessions.filter((s) => !s.deleted_at);
for (const cls of classes) {
  const s = settingsOf.get(cls.owner_id) ?? mergeSettings(null);
  const weights = weightsOf.get(cls.owner_id) ?? {};
  const students = tables.students.filter((x) => x.class_id === cls.id && !x.deleted_at && x.active)
    .sort((a, b) => a.sort_order - b.sort_order || a.full_name.localeCompare(b.full_name, "ar"));
  const subjects = tables.subjects.filter((x) => x.class_id === cls.id && !x.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const grades = {};
  for (const sj of subjects) {
    const entries = {};
    for (const g of tables.grade_entries) if (g.subject_id === sj.id) (entries[g.student_id] ??= {})[g.component] = { score: g.score === null ? null : Number(g.score), excused: g.excused };
    const sessions = liveSessions.filter((x) => x.subject_id === sj.id);
    const sesIds = new Set(sessions.map((x) => x.id));
    const assignments = tables.assignments.filter((a) => a.subject_id === sj.id && !a.deleted_at);
    const asgIds = new Set(assignments.map((a) => a.id));
    const records = tables.session_records.filter((r) => sesIds.has(r.session_id));
    const submissions = tables.assignment_submissions.filter((x) => asgIds.has(x.assignment_id));
    const agg = aggregate(sessions, records, assignments, submissions);
    const eff = effectiveSettings(s, weights[sj.id]);
    const rows = {};
    for (const st of students) rows[st.id] = computeRow(entries[st.id] ?? {}, eff, agg[st.id]);
    grades[sj.id] = { entries, agg, rows, sessions, records, assignments, submissions };
  }
  if (!subjects.length) continue;
  const sum = summarySheet(cls.name, students, subjects, grades, s);
  sheets.push({ ...sum, name: `ملخص ${cls.name}` });
  if (hasSemester2(subjects, grades)) sheets.push({ ...compareSheet(cls.name, students, subjects, grades, s), name: `مقارنة ${cls.name}` });
  for (const sj of subjects) sheets.push({ ...gradeSheet(sj, cls.name, students, grades[sj.id], s), name: `${cls.name} - ${sj.name}` });
}

// سجل الحضور والسلوك (كل الصفوف)
{
  const s0 = settingsOf.values().next().value ?? mergeSettings(null);
  const L = s0.labels;
  const sesById = new Map(liveSessions.filter((x) => !x.cancelled).map((x) => [x.id, x]));
  const subjById = new Map(tables.subjects.map((x) => [x.id, x]));
  const clsById = new Map(tables.classes.map((x) => [x.id, x]));
  const stById = new Map(tables.students.map((x) => [x.id, x]));
  const rows = tables.session_records
    .filter((r) => sesById.has(r.session_id))
    .map((r) => {
      const se = sesById.get(r.session_id), sj = subjById.get(se.subject_id), st = stById.get(r.student_id);
      return [se.date, clsById.get(sj?.class_id)?.name ?? "", sj?.name ?? "", st?.full_name ?? "", r.participation, r.disruption, r.late ? "✓" : "",
        r.absence === "excused" ? L.excused : r.absence === "unexcused" ? L.unexcused : "",
        r.homework === "done" ? L.hw_done : r.homework === "missing" ? L.hw_missing : "", r.note ?? ""];
    })
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1])));
  sheets.push({ name: "سجل الحضور والسلوك", header: ["التاريخ", "الصف", "المادة", "الاسم", L.participation, L.disruption, L.late, L.absent, L.homework, L.note], rows, widths: [12, 16, 16, 30, 9, 9, 9, 10, 12, 30] });
}

const xlsx = await writeXlsxFile(toXlsxSheets(sheets), { fontFamily: "Arial", fontSize: 11 }).toBuffer();
const json = Buffer.from(JSON.stringify({ version: BACKUP_VERSION, exported_at: new Date().toISOString(), tables }, null, 2));
console.log(`Excel: ${sheets.length} ورقة، ${Math.round(xlsx.length / 1024)} KB · JSON: ${Math.round(json.length / 1024)} KB`);

// ---------- نص الإيميل: أرقام الأسبوع والتنبيهات ----------
const weekAgo = addDays(todayISO, -6);
const weekSessions = liveSessions.filter((x) => !x.cancelled && x.date >= weekAgo && x.date <= todayISO);
const weekIds = new Set(weekSessions.map((x) => x.id));
const weekRecords = tables.session_records.filter((r) => weekIds.has(r.session_id));
const loggedSessions = new Set(weekRecords.map((r) => r.session_id)).size;
const absences = weekRecords.filter((r) => r.absence).length;
const since = new Date(Date.now() - 7 * 864e5).toISOString();
const newGrades = tables.grade_entries.filter((g) => g.updated_at >= since && (g.score !== null || g.excused)).length;

const alertLines = [];
let alertCount = 0;
for (const [owner, s] of settingsOf) {
  const ownClasses = tables.classes.filter((c) => c.owner_id === owner && !c.deleted_at && !c.archived);
  if (!ownClasses.length) continue;
  const data = {
    classes: ownClasses,
    students: tables.students.filter((x) => x.owner_id === owner),
    subjects: tables.subjects.filter((x) => x.owner_id === owner),
    slots: tables.schedule_slots.filter((x) => x.owner_id === owner),
    sessions: tables.sessions.filter((x) => x.owner_id === owner),
    records: tables.session_records.filter((x) => x.owner_id === owner),
    grades: tables.grade_entries.filter((x) => x.owner_id === owner),
    assignments: tables.assignments.filter((x) => x.owner_id === owner && !x.deleted_at),
    submissions: tables.assignment_submissions.filter((x) => x.owner_id === owner),
    dates: tables.assessment_dates.filter((x) => x.owner_id === owner),
    weights: weightsOf.get(owner) ?? {},
  };
  const states = tables.alert_states.filter((x) => x.owner_id === owner);
  for (const g of groupAlerts(visibleAlerts(computeAlerts(data, s, todayISO), states, todayISO), s)) {
    alertCount += g.items.length;
    alertLines.push(`• ${g.title}`);
    for (const i of g.items.slice(0, 8)) alertLines.push(`   - ${i.label}${i.detail ? ` (${i.detail})` : ""}`);
    if (g.items.length > 8) alertLines.push(`   … و${g.items.length - 8} أخرى`);
  }
}
console.log(`التنبيهات المفتوحة: ${alertCount}`);

const teacher = settingsOf.values().next().value?.profile?.teacher_name || "";
const text = [
  `مرحبا${teacher ? ` ${teacher}` : ""}،`,
  "",
  `النسخة الاحتياطية الأسبوعية — ${todayISO}`,
  "",
  "هذا الأسبوع:",
  `• حصص مسجلة: ${loggedSessions} من ${weekSessions.length}`,
  `• غياب: ${absences}`,
  `• علامات جديدة: ${newGrades}`,
  "",
  alertCount ? `التنبيهات المفتوحة (${alertCount}):` : "لا توجد تنبيهات مفتوحة 👍",
  ...alertLines,
  "",
  "المرفقات:",
  "• ملف Excel بكل العلامات (ورقة لكل مادة، ملخص لكل صف، وسجل الحضور والسلوك).",
  "• ملف JSON للاسترجاع: الموقع ← الإعدادات ← البيانات ← «استيراد نسخة احتياطية».",
].join("\n");

const xlsxName = `علامات-${todayISO}.xlsx`;
const jsonName = `نسخة-احتياطية-${todayISO}.json`;

if (DRY) {
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "backup-"));
  writeFileSync(join(dir, xlsxName), xlsx);
  writeFileSync(join(dir, jsonName), json);
  writeFileSync(join(dir, "email.txt"), text);
  console.log(`تجربة بدون إرسال: الملفات في ${dir}`);
} else {
  const mail = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  await mail.sendMail({
    from: `نظام العلامات <${SMTP_USER}>`,
    to: TO,
    subject: `النسخة الاحتياطية الأسبوعية — ${todayISO}`,
    text,
    attachments: [
      { filename: xlsxName, content: xlsx, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { filename: jsonName, content: json, contentType: "application/json" },
    ],
  });
  console.log("أُرسل الإيميل.");
}
