// الجداول التي تدخل في «تصدير كل البيانات» وفي النسخة الاحتياطية الأسبوعية (بنفس الشكل).
export const BACKUP_TABLES = [
  "classes", "students", "subjects", "schedule_slots", "sessions", "session_records",
  "assignments", "assignment_submissions", "grade_entries", "settings",
  "assessment_dates", "alert_states", "message_log",
] as const;
export const BACKUP_VERSION = 2;
