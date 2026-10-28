// تحويل أوراق الجداول (SheetSpec) إلى شكل write-excel-file.
// يُستعمل في المتصفح (التصدير) وفي النسخة الاحتياطية الأسبوعية (GitHub Actions).
import type { SheetSpec } from "./excel-types";

function safeSheetName(n: string, used: Set<string>) {
  const base = n.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Sheet";
  let name = base, i = 2;
  while (used.has(name)) name = `${base.slice(0, 25)} ${i++}`;
  used.add(name);
  return name;
}

const BORDER = { borderStyle: "thin" as const, borderColor: "#999999" };

export function toXlsxSheets(sheets: SheetSpec[]) {
  const used = new Set<string>();
  return sheets.map((s) => {
    const cols = Math.max(1, s.header.length);
    const data: unknown[][] = [];
    if (s.title) data.push([{ value: s.title, fontWeight: "bold", fontSize: 14, columnSpan: cols }, ...Array(cols - 1).fill(null)]);
    data.push(s.header.map((h) => ({ value: h, fontWeight: "bold" as const, backgroundColor: "#D5EBE5", align: "center" as const, alignVertical: "center" as const, wrap: true, ...BORDER })));
    for (const row of s.rows) {
      data.push(row.map((v, i) => ({
        value: v === null || v === undefined || v === "" ? undefined : v,
        type: typeof v === "number" ? Number : String,
        align: i > 1 ? ("center" as const) : undefined,
        ...BORDER,
      })));
    }
    return {
      data,
      sheet: safeSheetName(s.name, used),
      rightToLeft: true,
      stickyRowsCount: s.title ? 2 : 1,
      columns: s.header.map((_, i) => ({ width: s.widths?.[i] ?? (i === 1 ? 30 : 12) })),
    };
  });
}
