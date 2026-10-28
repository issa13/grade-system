"use client";
// استيراد وتصدير ملفات Excel و CSV في المتصفح.
// write-excel-file للتصدير، read-excel-file للاستيراد، papaparse لملفات CSV.

export type { Cell, SheetSpec } from "./excel-types";
import type { SheetSpec, Cell } from "./excel-types";
import { toXlsxSheets } from "./xlsx-sheets";

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function exportXlsx(sheets: SheetSpec[], filename: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const blob = await writeXlsxFile(toXlsxSheets(sheets) as never, { fontFamily: "Arial", fontSize: 11 }).toBlob();
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
