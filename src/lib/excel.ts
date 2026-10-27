"use client";
// استيراد وتصدير ملفات Excel و CSV في المتصفح.

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
  let base = n.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) || "Sheet";
  let name = base, i = 2;
  while (used.has(name)) name = `${base.slice(0, 25)} ${i++}`;
  used.add(name);
  return name;
}

export async function exportXlsx(sheets: SheetSpec[], filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "نظام إدارة العلامات";
  const used = new Set<string>();
  for (const s of sheets) {
    const ws = wb.addWorksheet(safeSheetName(s.name, used), { views: [{ rightToLeft: true, state: "frozen", ySplit: s.title ? 2 : 1 }] });
    if (s.title) {
      const r = ws.addRow([s.title]);
      r.font = { bold: true, size: 14 };
      ws.mergeCells(1, 1, 1, Math.max(1, s.header.length));
    }
    const h = ws.addRow(s.header);
    h.font = { bold: true };
    h.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD5EBE5" } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    });
    for (const row of s.rows) {
      const r = ws.addRow(row.map((v) => (v === undefined ? null : v)));
      r.eachCell({ includeEmpty: true }, (c, col) => {
        c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        if (col > 2) c.alignment = { horizontal: "center" };
      });
    }
    s.header.forEach((_, i) => {
      ws.getColumn(i + 1).width = s.widths?.[i] ?? (i === 1 ? 30 : 12);
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
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

/** قراءة أول ورقة من ملف xlsx/xlsm/csv كمصفوفة صفوف. */
export async function readTable(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const res = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
    return res.data.map((r) => r.map((c) => String(c ?? "").trim()));
  }
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find((w) => w.state === "visible" && w.rowCount > 0) ?? wb.worksheets[0];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals: string[] = [];
    for (let i = 1; i <= ws.columnCount; i++) {
      const v = row.getCell(i).value as unknown;
      let s = "";
      if (v === null || v === undefined) s = "";
      else if (typeof v === "object") {
        const o = v as { result?: unknown; text?: string; richText?: { text: string }[] };
        if (o.richText) s = o.richText.map((t) => t.text).join("");
        else if (o.text !== undefined) s = String(o.text);
        else if (o.result !== undefined) s = String(o.result ?? "");
        else if (v instanceof Date) s = v.toISOString().slice(0, 10);
      } else s = String(v);
      vals.push(s.trim());
    }
    if (vals.some((x) => x)) out.push(vals);
  });
  return out;
}
