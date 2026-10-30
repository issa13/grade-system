import { describe, expect, it } from "vitest";
import { buildStudentReport, ME, type Report } from "./student-report";
import { classStats, rankOf, attendance } from "./stats";
import { mergeSettings } from "./settings";
import { validateSection } from "./validate-settings";

const S = mergeSettings({ grading: { ...mergeSettings(null).grading, progress_mode: "manual" } });
const sj = { id: "s1", name: "رياضيات", color: "#000", weight: 1 };
const e = (component: string, score: number) => ({ subject_id: "s1", component: component as never, score, excused: false });
const rep = (classmates: Report["classmates"] = []): Report => ({
  student: { name: "أحمد", number: "7", class_name: "BT3", school_year: "2026-2027" },
  settings: {},
  subjects: [sj],
  entries: [e("p1", 16), e("p2", 14), e("m1", 15)],
  behavior: [], assignments: [{ subject_id: "s1", semester: 1, done: 2, late: 1, missing: 1 }],
  records: [
    { session_id: "a", date: "2026-10-05", subject_id: "s1", semester: 1, participation: 2, disruption: 0, late: false, absence: null, homework: "done" },
    { session_id: "b", date: "2026-10-12", subject_id: "s1", semester: 1, participation: 0, disruption: 1, late: false, absence: "unexcused", homework: null },
  ],
  dates: [{ subject_id: "s1", component: "p1", date: "2026-10-01" }],
  classmates,
});

describe("رابط الطالب: نفس حسابات صفحة الأستاذ", () => {
  it("المعدلات والحضور من بيانات الطالب", () => {
    const b = buildStudentReport(rep(), S);
    expect(b.pool).toHaveLength(1);
    expect(b.data.s1.rows[ME].sem1).toBe(15);
    const att = attendance(b.data.s1, ME);
    expect(att.sessions).toBe(2);
    expect(att.absent).toBe(1);
    expect(att.attendanceRate).toBe(50);
    expect(att.hwDone).toBe(1 + 3); // من الحصص + الواجبات (المتأخرة منجزة)
    expect(att.hwMissing).toBe(1);
    expect(b.dates.s1.p1).toBe("2026-10-01");
  });
  it("الترتيب ومعدل الصف من الزملاء بدون أسماء", () => {
    const mate = (p: number) => ({ entries: [e("p1", p), e("p2", p), e("m1", p)], behavior: [], assignments: [] });
    const b = buildStudentReport(rep([mate(18), mate(10)]), S);
    expect(b.pool.map((x) => x.id)).toEqual([ME, "m1", "m2"]);
    expect(b.pool.some((x) => x.full_name === "أحمد" && x.id !== ME)).toBe(false);
    const cs = classStats(b.pool, b.subjects, b.data, S);
    expect(rankOf(cs.ranked, ME)).toBe(2);
  });
});

describe("التحقق من الإعدادات", () => {
  const s = mergeSettings(null);
  it("يرفض قيماً خاطئة", () => {
    expect(validateSection("grading", { ...s.grading, pass_mark: 25 }, s)).toMatch(/علامة النجاح/);
    expect(validateSection("grading", { ...s.grading, periodic_weight: 0, midterm_weight: 0 }, s)).toMatch(/أكبر من صفر/);
    expect(validateSection("year", { ...s.year, sem1_end: "2026-01-01" }, s)).toMatch(/بداية السنة/);
    expect(validateSection("whatsapp", { ...s.whatsapp, country_code: "+961" }, s)).toMatch(/مفتاح الدولة/);
    expect(validateSection("grading", { ...s.grading, bands: [...s.grading.bands, { min: 18, label: "x", color: "#000" }] }, s)).toMatch(/بنفس/);
  });
  it("يقبل الإعدادات الافتراضية", () => {
    for (const k of ["grading", "behavior", "year", "schedule", "whatsapp", "alerts", "trajectory", "data", "labels"] as const) {
      expect(validateSection(k, s[k] as never, s)).toBeNull();
    }
  });
});
