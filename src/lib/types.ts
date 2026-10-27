import type { Component } from "./settings";

export type ClassRow = {
  id: string; name: string; school_year: string | null; notes: string | null;
  archived: boolean; deleted_at: string | null; created_at: string;
};
export type Student = {
  id: string; class_id: string; full_name: string; student_number: string | null; notes: string | null;
  share_token: string; share_enabled: boolean; active: boolean; sort_order: number;
  deleted_at: string | null; created_at: string;
};
export type Subject = {
  id: string; class_id: string; name: string; color: string; weight: number;
  deleted_at: string | null; created_at: string;
};
export type Slot = { id: string; subject_id: string; weekday: number; start_time: string | null; end_time: string | null };
export type Session = {
  id: string; subject_id: string; schedule_slot_id: string | null; date: string; semester: 1 | 2;
  topic: string | null; cancelled: boolean; locked: boolean; deleted_at: string | null;
};
export type SessionRecord = {
  id?: string; session_id: string; student_id: string; participation: number; disruption: number;
  late: boolean; absence: "excused" | "unexcused" | null; homework: "done" | "missing" | null; note: string | null;
};
export type Assignment = {
  id: string; subject_id: string; title: string; due_date: string | null; semester: 1 | 2;
  max_score: number | null; deleted_at: string | null;
};
export type Submission = {
  id?: string; assignment_id: string; student_id: string; status: "done" | "missing" | "late" | null; score: number | null;
};
export type GradeEntry = {
  id?: string; subject_id: string; student_id: string; component: Component; score: number | null; excused: boolean;
};

export const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
