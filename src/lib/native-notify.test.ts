import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replanAppNotifications } from "./native-notify";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";
import type { AlertData } from "./alerts";
import type { Session, SessionRecord, Student } from "./types";

// تطبيق أندرويد: جدولة الإشعارات على التلفون (بدون تلفون حقيقي: Capacitor وهمي)
const S = mergeSettings(DEFAULT_SETTINGS);
const st = (id: string): Student => ({ id, class_id: "c", full_name: id, student_number: null, notes: null, share_token: id, share_enabled: true, active: true, sort_order: 0, deleted_at: null, created_at: "" });
const ses = (id: string, date: string): Session => ({ id, subject_id: "sj", schedule_slot_id: null, date, semester: 1, topic: null, cancelled: false, locked: false, deleted_at: null });
const rec = (session_id: string, student_id: string): SessionRecord => ({ session_id, student_id, participation: 0, disruption: 0, late: false, absence: null, homework: null, note: null });
const data = (): AlertData => ({
  classes: [{ id: "c", name: "BT3", school_year: null, notes: null, archived: false, deleted_at: null, created_at: "" }],
  students: [st("a")], subjects: [{ id: "sj", class_id: "c", name: "رياضيات", color: "#000", weight: 1, deleted_at: null, created_at: "" }], slots: [],
  // s1 مسجّلة، s3 و s4 لا (أمس وما قبله)، s6 اليوم (تصبح تنبيهاً غداً)
  sessions: [ses("s1", "2026-10-20"), ses("s3", "2026-10-26"), ses("s4", "2026-10-27"), ses("s6", "2026-10-28")],
  records: [rec("s1", "a")], grades: [], assignments: [], submissions: [], dates: [], weights: {},
});

let scheduled: { id: number; title: string; schedule?: { at: Date } }[][] = [];
beforeEach(() => {
  scheduled = [];
  const store = new Map<string, string>([["gs_app_notify", "1"]]);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications: {
    checkPermissions: async () => ({ display: "granted" }),
    cancel: async () => {},
    schedule: async (o: { notifications: never[] }) => { scheduled.push(o.notifications); },
  } } } });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("إشعارات التطبيق", () => {
  it("الجديد اليوم فوراً، والقادم صباح يومه، ولا تكرار", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 10, 0)); // الأربعاء 10:00
    await replanAppNotifications(data(), [], S);
    const [list] = scheduled;
    expect(list.map((n) => n.title)).toEqual(["في حصتين ما سجّلتها", "في حصة ما سجّلتها"]);
    expect(list[0].schedule!.at.getTime() - Date.now()).toBeLessThan(5000);
    expect(list[1].schedule!.at).toEqual(new Date(2026, 9, 29, 7, 0));

    // بعد ساعة: إشعار اليوم وصل ولا يتكرر؛ سجّلت حصة اليوم فأُلغي إشعار الغد
    vi.setSystemTime(new Date(2026, 9, 28, 11, 0));
    const d = data();
    d.records.push(rec("s6", "a"));
    await replanAppNotifications(d, [], S);
    expect(scheduled).toHaveLength(1);
  });

  it("ساعات الهدوء: تنتقل إلى الصباح", async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 21, 30));
    await replanAppNotifications(data(), [], S);
    const [list] = scheduled;
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("في 3 حصص ما سجّلتها");
    expect(list[0].schedule!.at).toEqual(new Date(2026, 9, 29, 7, 0));
  });

  it("العطلة الأسبوعية (السبت) تُتخطّى", async () => {
    vi.setSystemTime(new Date(2026, 9, 31, 10, 0)); // السبت
    await replanAppNotifications(data(), [], S);
    const [list] = scheduled;
    expect(list[0].schedule!.at).toEqual(new Date(2026, 10, 1, 7, 0));
  });
});
