import { describe, expect, it } from "vitest";
import { fillTemplate, normalizePhone, prettyPhone } from "./whatsapp";
import { examOrder, markDrops, subjectPoints, trendOf } from "./trajectory";
import { buildWeek, weekDays, weekStartFor, weekProgress } from "./schedule";
import { computeAlerts, groupAlerts, visibleAlerts, type AlertData } from "./alerts";
import { computeRow, semesterValue } from "./grades";
import { mergeSettings, DEFAULT_WA_TEMPLATE } from "./settings";
import { sessionIdFor, stableUuid } from "./ids";
import type { Session, SessionRecord, Slot, Student, Subject } from "./types";

const S = mergeSettings({ year: { ...mergeSettings(null).year, start: "2026-09-01", end: "2027-06-30", sem1_end: "2027-01-31", weekend_days: [0, 6] } });

describe("أرقام واتساب", () => {
  it("كل الأشكال تعطي نفس النتيجة", () => {
    for (const x of ["03 123456", "+961 3 123456", "9613123456", "03 123 456", "00961 3 123 456", "+961 03 123456", "٠٣ ١٢٣ ٤٥٦"]) {
      expect(normalizePhone(x)).toBe("9613123456");
    }
  });
  it("71/76/78/79/81", () => {
    expect(normalizePhone("71 123 456")).toBe("96171123456");
    expect(normalizePhone("81123456")).toBe("96181123456");
    expect(normalizePhone("+961 76 123 456")).toBe("96176123456");
  });
  it("رقم غير صالح", () => {
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
  });
  it("عرض مقروء", () => {
    expect(prettyPhone("9613123456")).toBe("+961 3 123 456");
    expect(prettyPhone("96171123456")).toBe("+961 71 123 456");
  });
});

describe("قالب الرسالة", () => {
  it("السطر الذي فيه خانة فارغة يُحذف", () => {
    const t = fillTemplate(DEFAULT_WA_TEMPLATE, { الاسم: "أحمد", غياب: 0, تأخير: 1, مشاركة: 5, وظائف_ناقصة: 2, مواد_تحت_النجاح: "", الرابط: "https://x", اسم_الأستاذ: "الأستاذ علي" });
    expect(t).toContain("مرحبا أحمد");
    expect(t).toContain("الغياب: 0");
    expect(t).not.toContain("{");
    expect(t.split("\n")).toHaveLength(5);
  });
});

describe("مسار الطالب", () => {
  it("14 ثم 15 ثم 11 ← يتراجع + هبوط مفاجئ", () => {
    const pts = markDrops([14, 15, 11].map((score) => ({ score, drop: false })), S);
    expect(pts.map((p) => p.drop)).toEqual([false, false, true]);
    expect(trendOf([14, 15, 11], S)).toBe("down");
    expect(trendOf([10, 11, 12], S)).toBe("up");
    expect(trendOf([12, 12.5, 12.8], S)).toBe("flat");
    expect(trendOf([12], S)).toBeNull();
  });
  it("ترتيب الامتحانات بدون تاريخ = الترتيب الطبيعي", () => {
    expect(examOrder({}).map((x) => x.comp)).toEqual(["p1", "p2", "m1", "p3", "p4", "m2"]);
    expect(examOrder({ p1: "2026-10-10", p2: "2026-09-20" }).map((x) => x.comp).slice(0, 2)).toEqual(["p2", "p1"]);
  });
  it("المعفى لا يظهر كنقطة صفر", () => {
    const rows = { a: computeRow({ p1: { score: 14 }, p2: { score: null, excused: true }, m1: { score: 12 } }, S) };
    const pts = subjectPoints("a", rows, {}, S);
    expect(pts.map((p) => p.comp)).toEqual(["p1", "m1"]);
  });
});

describe("مقارنة النصفين", () => {
  it("النصف غير المكتمل يُحسب حتى الآن", () => {
    const r = computeRow({ p1: { score: 16 }, p2: { score: 14 }, m1: { score: 15 }, p3: { score: 12 } }, mergeSettings({ grading: { ...S.grading, progress_mode: "manual" } }));
    expect(semesterValue(r, 1)).toEqual({ value: r.sem1, partial: false });
    expect(semesterValue(r, 2)).toEqual({ value: 12, partial: true });
  });
});

describe("المعرّفات", () => {
  it("نفس الموعد والتاريخ = نفس المعرّف", () => {
    expect(sessionIdFor("slot", "2026-10-05")).toBe(sessionIdFor("slot", "2026-10-05"));
    expect(sessionIdFor("slot", "2026-10-05")).not.toBe(sessionIdFor("slot", "2026-10-06"));
    expect(stableUuid("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

const subjInfo = { id: "sj", name: "رياضيات", color: "#000", class_id: "c", class_name: "BT3" };
const slot = (id: string, weekday: number, start: string | null, end: string | null) => ({ id, subject_id: "sj", weekday, start_time: start, end_time: end, subject: subjInfo }) as Slot & { subject: typeof subjInfo };

describe("البرنامج الأسبوعي", () => {
  it("بداية الأسبوع بعد العطلة", () => {
    expect(weekStartFor("2026-10-28", [0, 6])).toBe("2026-10-26"); // أربعاء ← الإثنين
    expect(weekStartFor("2026-10-31", [0, 6])).toBe("2026-11-02"); // السبت ← الأسبوع القادم
    expect(weekStartFor("2026-10-28", [6])).toBe("2026-10-25"); // العطلة السبت فقط ← يبدأ الأحد
  });
  it("الحالات والحصص غير المولّدة", () => {
    const days = weekDays("2026-10-26", S, "2026-10-28");
    expect(days.map((d) => d.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    const slots = [slot("a", 1, "08:00", "08:50"), slot("b", 3, "09:00", "09:50"), slot("c", 3, "10:00", "10:50"), slot("d", 4, null, null)];
    const real: Session & { subject: typeof subjInfo } = { id: "r1", subject_id: "sj", schedule_slot_id: "a", date: "2026-10-26", semester: 1, topic: null, cancelled: false, locked: false, deleted_at: null, subject: subjInfo };
    const now = new Date(2026, 9, 28, 9, 30);
    const { rows, instances } = buildWeek({ days, slots, sessions: [real], summaries: { r1: { records: 20, absent: 2, excused: 0, late: 0, participation: 14, disruption: 0, hwDone: 0, hwMissing: 0 } }, settings: S, now });
    expect(rows.map((r) => r.start)).toEqual(["08:00", "09:00", "10:00"]);
    const byDate = (d: string, st: string | null) => instances.find((i) => i.date === d && i.start === st)!;
    expect(byDate("2026-10-26", "08:00").status).toBe("logged");
    expect(byDate("2026-10-28", "09:00").status).toBe("now");
    expect(byDate("2026-10-28", "10:00").status).toBe("upcoming");
    expect(byDate("2026-10-28", "10:00").next).toBe(true);
    expect(byDate("2026-10-29", null).status).toBe("upcoming");
    expect(byDate("2026-10-28", "09:00").id).toBe(sessionIdFor("b", "2026-10-28"));
    const p = weekProgress(instances);
    expect(p.logged).toBe(1);
    expect(p.due).toBe(2);
  });
  it("لا حصص في العطلة", () => {
    const s2 = mergeSettings({ ...S, year: { ...S.year, breaks: [{ from: "2026-10-27", to: "2026-10-27", label: "عيد" }] } });
    const days = weekDays("2026-10-26", s2, "2026-10-28");
    expect(days[1].holiday).toBe("عيد");
    const { instances } = buildWeek({ days, slots: [slot("x", 2, "08:00", "08:50")], sessions: [], summaries: {}, settings: s2, now: new Date(2026, 9, 28) });
    expect(instances).toHaveLength(0);
  });
});

describe("التنبيهات", () => {
  const st = (id: string): Student => ({ id, class_id: "c", full_name: id, student_number: null, notes: null, share_token: id, share_enabled: true, active: true, sort_order: 0, deleted_at: null, created_at: "" });
  const subj: Subject = { id: "sj", class_id: "c", name: "رياضيات", color: "#000", weight: 1, deleted_at: null, created_at: "" };
  const ses = (id: string, date: string): Session => ({ id, subject_id: "sj", schedule_slot_id: null, date, semester: 1, topic: null, cancelled: false, locked: false, deleted_at: null });
  const rec = (session_id: string, student_id: string, p: Partial<SessionRecord> = {}): SessionRecord => ({ session_id, student_id, participation: 0, disruption: 0, late: false, absence: null, homework: null, note: null, ...p });
  const base = (): AlertData => ({
    classes: [{ id: "c", name: "BT3", school_year: null, notes: null, archived: false, deleted_at: null, created_at: "" }],
    students: [st("a"), st("b")], subjects: [subj], slots: [],
    sessions: [ses("s1", "2026-10-20"), ses("s2", "2026-10-22"), ses("s3", "2026-10-26"), ses("s4", "2026-10-27")],
    records: [], grades: [], assignments: [], submissions: [], dates: [], weights: {},
  });
  it("غياب 3 حصص متتالية", () => {
    const d = base();
    d.records = [rec("s1", "a"), rec("s2", "a", { absence: "unexcused" }), rec("s3", "a", { absence: "excused" }), rec("s4", "a", { absence: "unexcused" }), rec("s1", "b"), rec("s2", "b"), rec("s3", "b"), rec("s4", "b")];
    const items = computeAlerts(d, S, "2026-10-28");
    const ab = items.filter((i) => i.rule === "absence_streak");
    expect(ab).toHaveLength(1);
    expect(ab[0].studentId).toBe("a");
    // «تمّ» يخفيه حتى غياب جديد
    const done = [{ key: ab[0].key, status: "done" as const, fingerprint: ab[0].fingerprint, snoozed_until: null }];
    expect(visibleAlerts(ab, done, "2026-10-28")).toHaveLength(0);
    d.sessions.push(ses("s5", "2026-10-28"));
    d.records.push(rec("s5", "a", { absence: "unexcused" }), rec("s5", "b"));
    const again = computeAlerts(d, S, "2026-10-28").filter((i) => i.rule === "absence_streak");
    expect(visibleAlerts(again, done, "2026-10-28")).toHaveLength(1);
  });
  it("حصص غير مسجلة وإيقاف القاعدة", () => {
    const d = base();
    d.records = [rec("s1", "a"), rec("s2", "a")];
    const items = computeAlerts(d, S, "2026-10-28").filter((i) => i.rule === "unlogged");
    expect(items.map((i) => i.key)).toEqual(["unlogged:s3", "unlogged:s4"]);
    expect(groupAlerts(items, S)[0].title).toBe("في حصتين ما سجّلتها");
    const off = mergeSettings({ ...S, alerts: { ...S.alerts, unlogged_on: false } });
    expect(computeAlerts(d, off, "2026-10-28").filter((i) => i.rule === "unlogged")).toHaveLength(0);
  });
  it("هبوط مفاجئ وتحت النجاح", () => {
    const d = base();
    d.grades = [
      { subject_id: "sj", student_id: "a", component: "p1", score: 14, excused: false },
      { subject_id: "sj", student_id: "a", component: "p2", score: 15, excused: false },
      { subject_id: "sj", student_id: "a", component: "m1", score: 11, excused: false },
    ];
    const items = computeAlerts(d, S, "2026-10-28");
    expect(items.some((i) => i.rule === "drop" && i.studentId === "a")).toBe(true);
  });
});
