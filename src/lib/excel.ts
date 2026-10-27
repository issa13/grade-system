"use client";
import type { SheetData } from "write-excel-file/browser";
// استيراد وتصدير ملفات Excel و CSV في المتصفح.
// write-excel-file للتصدير، read-excel-file للاستيراد، papaparse لملفات CSV.

export type Cell = string | number | null | undefined;
export type SheetSpec = {
  name: string;
  title?: string; // سطر عنوان فوق الجدول
  header: string[];
  rows: Cell[][];
  widths?: number[];
};

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function safeSheetName(n: string, used: Set<string>) {
  const base = n.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Sheet";
  let name = base, i = 2;
  while (used.has(name)) name = `${base.slice(0, 25)} ${i++}`;
  used.add(name);
  return name;
}

const BORDER = { borderStyle: "thin" as const, borderColor: "#999999" };

export async function exportXlsx(sheets: SheetSpec[], filename: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const used = new Set<string>();
  const out = sheets.map((s) => {
    const cols = Math.max(1, s.header.length);
    const data: SheetData = [];
    if (s.title) {
      data.push([{ value: s.title, fontWeight: "bold", fontSize: 14, columnSpan: cols }, ...Array(cols - 1).fill(null)]);
    }
    data.push(s.header.map((h) => ({ value: h, fontWeight: "bold" as const, backgroundColor: "#D5EBE5", align: "center" as const, alignVertical: "center" as const, wrap: true, ...BORDER })));
    for (const row of s.rows) {
      data.push(row.map((v, i) => ({
        value: v === null || v === undefined || v === "" ? undefined : v,
        type: typeof v === "number" ? Number : String,
        align: i > 1 ? ("center" as const) : undefined,
        ...BORDER,
      })) as never);
    }
    return {
      data,
      sheet: safeSheetName(s.name, used),
      rightToLeft: true,
      stickyRowsCount: s.title ? 2 : 1,
      columns: s.header.map((_, i) => ({ width: s.widths?.[i] ?? (i === 1 ? 30 : 12) })),
    };
  });
  const blob = await writeXlsxFile(out as never, { fontFamily: "Arial", fontSize: 11 }).toBlob();
  download(blob, filename);
}

export function exportCsv(header: string[], rows: Cell[][], filename: string) {
  const esc = (v: Cell) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  download(new Blob([text], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadJson(obj: unknown, filename: string) {
  download(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename);
}

const NAME_HEADER = /^(الاسم|اسم الطالب|الاسم الكامل|name|full ?name|student ?name)$/i;

/**
 * قراءة ملف xlsx/xlsm/csv كمصفوفة صفوف.
 * إذا كان الملف فيه عدة أوراق، تُختار أول ورقة فيها عمود «الاسم».
 */
export async function readTable(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const clean = (rows: unknown[][]) =>
    rows
      .map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c).trim())))
      .filter((r) => r.some((x) => x));

  if (name.endsWith(".csv")) {
    const { default: Papa } = await import("papaparse");
    const text = await file.text();
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
    return clean(res.data);
  }
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  const tables = sheets.map((s) => clean(s.data as unknown[][]));
  const withNames = tables.find((t) => t.slice(0, 20).some((r) => r.some((c) => NAME_HEADER.test(c))));
  return withNames ?? tables.find((t) => t.length > 0) ?? [];
}
