import { describe, expect, it } from "vitest";
import { computeRow, overallAverage, bandFor, progressFromBehavior } from "./grades";
import { DEFAULT_SETTINGS, effectiveSettings, mergeSettings } from "./settings";

// الاختبارات الأصلية مكتوبة على ملف الإكسل (النصف من 40، السعي يدوي)
const S = mergeSettings({ grading: { ...DEFAULT_SETTINGS.grading, max_midterm: 40, progress_mode: "manual" } });

describe("computeRow — معادلات ملف الإكسل", () => {
  it("فارغ عندما لا توجد أي علامة", () => {
    const r = computeRow({}, S);
    expect(r.sem1).toBeNull();
    expect(r.sem2).toBeNull();
    expect(r.final).toBeNull();
  });

  it("يحسب النصف الأول: (معدل الفتريين×15 + الفصل×25)/40 بعد التحويل إلى 20", () => {
    // الفتري 16 و 14 من 20 → معدل 15 ؛ الفصل 30 من 40 → 15
    const r = computeRow({ p1: { score: 16 }, p2: { score: 14 }, m1: { score: 30 } }, S);
    expect(r.m1).toBe(15);
    expect(r.sem1).toBe(15);
  });

  it("وزن مختلف بين الفتري والفصل", () => {
    // معدل الفتري 20 ، الفصل 0 → (20×15 + 0×25)/40 = 7.5
    const r = computeRow({ p1: { score: 20 }, p2: { score: 20 }, m1: { score: 0 } }, S);
    expect(r.sem1).toBe(7.5);
  });

  it("NC عندما تنقص علامة في النصف", () => {
    const r = computeRow({ p1: { score: 16 }, m1: { score: 30 } }, S);
    expect(r.sem1).toBe("NC");
    expect(r.final).toBe("NC");
  });

  it("النهائي = النصف1×0.4 + النصف2×0.4 + السعي1×0.1 + السعي2×0.1", () => {
    const r = computeRow(
      {
        p1: { score: 16 }, p2: { score: 14 }, m1: { score: 30 }, pr1: { score: 18 },
        p3: { score: 12 }, p4: { score: 12 }, m2: { score: 24 }, pr2: { score: 16 },
      },
      S,
    );
    expect(r.sem1).toBe(15);
    expect(r.sem2).toBe(12);
    // 15×0.4 + 12×0.4 + 18×0.1 + 16×0.1 = 6 + 4.8 + 1.8 + 1.6 = 14.2
    expect(r.final).toBe(14.2);
  });

  it("سياسة الصفر بدل NC", () => {
    const s = mergeSettings({ grading: { ...S.grading, missing_policy: "zero" } });
    const r = computeRow({ p1: { score: 20 }, m1: { score: 40 } }, s);
    // معدل الفتري (20+0)/2=10 → (10×15 + 20×25)/40 = 16.25
    expect(r.sem1).toBe(16.25);
  });

  it("المعفى لا يدخل في المعدل", () => {
    const r = computeRow({ p1: { score: 20 }, p2: { score: null, excused: true }, m1: { score: 40 } }, S);
    expect(r.sem1).toBe(20);
  });

  it("الأوزان من الإعدادات وليست ثابتة", () => {
    const s = mergeSettings({ grading: { ...S.grading, periodic_weight: 10, midterm_weight: 30 } });
    const r = computeRow({ p1: { score: 20 }, p2: { score: 20 }, m1: { score: 0 } }, s);
    expect(r.sem1).toBe(5);
  });

  it("السعي من السلوك عند اختيار ذلك", () => {
    const s = mergeSettings({ grading: { ...S.grading, progress_mode: "behavior" } });
    const r = computeRow({}, s, { 1: { sessions: 10, participation: 4, disruption: 1 } });
    // 14 + 4×0.5 - 1 = 15
    expect(r.pr1).toBe(15);
  });

  it("التقريب", () => {
    const r = computeRow({ p1: { score: 13 }, p2: { score: 14 }, m1: { score: 27 } }, S);
    // معدل الفتري 13.5 ، الفصل 13.5 → 13.5
    expect(r.sem1).toBe(13.5);
    const r2 = computeRow({ p1: { score: 13 }, p2: { score: 13 }, m1: { score: 25 } }, S);
    // (13×15 + 12.5×25)/40 = 12.6875 → 12.69
    expect(r2.sem1).toBe(12.69);
  });
});

describe("الإعدادات الافتراضية الجديدة", () => {
  const D = mergeSettings(null);
  it("كل العلامات من 20 والسعي من السلوك افتراضياً", () => {
    expect(D.grading.max_periodic).toBe(20);
    expect(D.grading.max_midterm).toBe(20);
    expect(D.grading.max_progress).toBe(20);
    expect(D.grading.progress_mode).toBe("behavior");
  });
  it("التسميات الجديدة، والتسميات القديمة المحفوظة تُستبدل", () => {
    expect(D.labels.p1).toBe("الفصل 1");
    expect(D.labels.m1).toBe("النصف 1");
    expect(D.labels.sem1).toBe("معدل النصف 1");
    const old = mergeSettings({ labels: { ...DEFAULT_SETTINGS.labels, p1: "الفتري 1", m1: "الفصل 1", sem1: "النصف 1", late: "متأخر" } });
    expect(old.labels.p1).toBe("الفصل 1");
    expect(old.labels.m1).toBe("النصف 1");
    expect(old.labels.sem1).toBe("معدل النصف 1");
    expect(old.labels.late).toBe("متأخر");
  });
  it("النصف من 20", () => {
    const r = computeRow({ p1: { score: 16 }, p2: { score: 14 }, m1: { score: 15 } }, D);
    expect(r.sem1).toBe(15);
  });
});

describe("العلامة حتى الآن", () => {
  it("تُحسب من العلامات الموجودة فقط عندما يكون النهائي NC", () => {
    const D = mergeSettings({ grading: { ...DEFAULT_SETTINGS.grading, progress_mode: "manual" } });
    const r = computeRow({ p1: { score: 16 }, m1: { score: 12 } }, D);
    expect(r.final).toBe("NC");
    // (16×15 + 12×25) / 40 = 13.5
    expect(r.current).toBe(13.5);
    expect(computeRow({}, D).current).toBeNull();
  });
});

describe("سلّم التقديرات", () => {
  it("السلّم القديم المحفوظ يُستبدل بالجديد، والمعدَّل يبقى", () => {
    const old = [16, 14, 12, 10, 0].map((min, i) => ({ min, label: ["ممتاز", "جيد جداً", "جيد", "مقبول", "راسب"][i], color: "#000000" }));
    const m = mergeSettings({ grading: { ...DEFAULT_SETTINGS.grading, bands: old } });
    expect(m.grading.bands.map((b) => b.min)).toEqual([18, 16, 14, 10, 0]);
    const custom = mergeSettings({ grading: { ...DEFAULT_SETTINGS.grading, bands: [{ min: 15, label: "ممتاز", color: "#000" }, { min: 0, label: "غيره", color: "#000" }] } });
    expect(custom.grading.bands.length).toBe(2);
  });
});

describe("إعدادات لكل نصف ولكل مادة", () => {
  const base = mergeSettings({ grading: { ...DEFAULT_SETTINGS.grading, progress_mode: "manual" } });
  const en = { p1: { score: 20 }, p2: { score: 20 }, m1: { score: 0 }, p3: { score: 20 }, p4: { score: 20 }, m2: { score: 0 } };
  it("نصف محفوظ بأوزان سابقة لا يتأثر بالتغيير", () => {
    const s = mergeSettings({
      grading: { ...base.grading, periodic_weight: 10, midterm_weight: 30 },
      semester_overrides: { "1": { grading: { periodic_weight: 15, midterm_weight: 25 } } },
    });
    const r = computeRow(en, effectiveSettings(s));
    expect(r.sem1).toBe(7.5); // الأوزان القديمة
    expect(r.sem2).toBe(5); // الأوزان الجديدة
  });
  it("أوزان خاصة بالمادة", () => {
    const r = computeRow(en, effectiveSettings(base, { periodic_weight: 1, midterm_weight: 1 }));
    expect(r.sem1).toBe(10);
    const r2 = computeRow({ ...en, pr1: { score: 20 }, pr2: { score: 20 } }, effectiveSettings(base, { sem1_weight: 0, sem2_weight: 0, progress1_weight: 1, progress2_weight: 1 }));
    expect(r2.final).toBe(20);
  });
});

describe("overall / bands / behavior", () => {
  it("المعدل العام بأوزان المواد", () => {
    expect(overallAverage([{ final: 10, weight: 1 }, { final: 16, weight: 2 }], S)).toBe(14);
    expect(overallAverage([{ final: 10, weight: 1 }, { final: "NC", weight: 1 }], S)).toBe("NC");
    expect(overallAverage([{ final: null, weight: 1 }], S)).toBeNull();
  });
  it("التقدير", () => {
    expect(bandFor(18, S)?.label).toBe("ممتاز");
    expect(bandFor(17, S)?.label).toBe("جيد جداً");
    expect(bandFor(15, S)?.label).toBe("جيد");
    expect(bandFor(12, S)?.label).toBe("مقبول");
    expect(bandFor(10, S)?.label).toBe("مقبول");
    expect(bandFor(9.99, S)?.label).toBe("راسب");
    expect(bandFor("NC", S)).toBeNull();
  });
  it("السعي محصور بين 0 والحد الأقصى", () => {
    expect(progressFromBehavior({ sessions: 5, participation: 100 }, S)).toBe(20);
    expect(progressFromBehavior({ sessions: 5, disruption: 100 }, S)).toBe(0);
    expect(progressFromBehavior({ sessions: 0 }, S)).toBeNull();
  });
});
