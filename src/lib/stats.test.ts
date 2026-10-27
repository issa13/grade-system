import { describe, expect, it } from "vitest";
import { attendance, classStats, distribution, rankOf, ranking, subjectStats } from "./stats";
import { mergeSettings } from "./settings";
import type { SubjectGrades } from "./class-data";
import type { Session, SessionRecord, Student, Subject } from "./types";

const S = mergeSettings(null);
const st = (id: string): Student => ({ id, class_id: "c", full_name: id, student_number: null, notes: null, share_token: id, share_enabled: true, active: true, sort_order: 0, deleted_at: null, created_at: "" });
const students = [st("a"), st("b"), st("c"), st("d")];
const row = (final: number | "NC" | null) => ({ p1: null, p2: null, m1: null, pr1: null, sem1: null, p3: null, p4: null, m2: null, pr2: null, sem2: null, final, current: typeof final === "number" ? final : null });
const sess = (id: string, date: string, cancelled = false): Session => ({ id, subject_id: "s1", schedule_slot_id: null, date, semester: 1, topic: null, cancelled, locked: false, deleted_at: null });
const rec = (session_id: string, student_id: string, p: Partial<SessionRecord> = {}): SessionRecord => ({ session_id, student_id, participation: 0, disruption: 0, late: false, absence: null, homework: null, note: null, ...p });

const data: SubjectGrades = {
  entries: {}, agg: {},
  rows: { a: row(18), b: row(9), c: row("NC"), d: row(12) },
  sessions: [sess("x", "2020-01-01"), sess("y", "2020-01-02"), sess("z", "2020-01-03", true), sess("w", "2020-01-04")],
  records: [rec("x", "a", { participation: 2 }), rec("x", "b", { absence: "unexcused" }), rec("y", "a", { late: true }), rec("y", "b", { absence: "excused" }), rec("z", "a", { absence: "unexcused" })],
};

describe("إحصائيات", () => {
  it("الحضور يتجاهل الحصص الملغاة", () => {
    const a = attendance(data, "a");
    expect(a.sessions).toBe(2);
    expect(a.absent).toBe(0);
    expect(a.participation).toBe(2);
    expect(a.attendanceRate).toBe(100);
    expect(attendance(data, "b").attendanceRate).toBe(0);
  });
  it("المادة: معدل، نجاح، توزيع، حصص غير مسجلة", () => {
    const s = subjectStats(students, data, S);
    expect(s.avgFinal).toBe(13);
    expect(s.passed).toBe(2);
    expect(s.passRate).toBe(66.7);
    expect(s.nc).toBe(1);
    expect(s.sessionsPast).toBe(3);
    expect(s.sessionsLogged).toBe(2);
    expect(s.unlogged.map((x) => x.id)).toEqual(["w"]);
    expect(s.distribution.find((b) => b.label === "ممتاز")?.count).toBe(1);
  });
  it("الترتيب مع التعادل", () => {
    const r = ranking(students, (x) => ({ a: 15, b: 15, c: 10, d: null } as Record<string, number | null>)[x.id]);
    expect(rankOf(r, "a")).toBe(1);
    expect(rankOf(r, "b")).toBe(1);
    expect(rankOf(r, "c")).toBe(3);
    expect(rankOf(r, "d")).toBeNull();
  });
  it("الصف: طلاب يحتاجون متابعة", () => {
    const subj: Subject = { id: "s1", class_id: "c", name: "م", color: "#000", weight: 1, deleted_at: null, created_at: "" };
    const cs = classStats(students, [subj], { s1: data }, S);
    expect(cs.atRisk.map((x) => x.student.id).sort()).toEqual(["b"]);
    expect(cs.ranked[0].student.id).toBe("a");
  });
  it("التوزيع يشمل NC وبدون علامات", () => {
    const d = distribution([19, 5, "NC", null], S);
    expect(d.find((b) => b.label.startsWith("NC"))?.count).toBe(1);
    expect(d.find((b) => b.label === "بدون علامات")?.count).toBe(1);
  });
});
