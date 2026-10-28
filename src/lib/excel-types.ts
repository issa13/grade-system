export type Cell = string | number | null | undefined;
export type SheetSpec = {
  name: string;
  title?: string; // سطر عنوان فوق الجدول
  header: string[];
  rows: Cell[][];
  widths?: number[];
};
