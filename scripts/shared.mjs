// أدوات مشتركة بين مهام GitHub Actions (النسخة الاحتياطية والإشعارات).
// المستودع عام: لا تطبع أي اسم أو علامة في السجل، فقط أعداداً.
import { createClient } from "@supabase/supabase-js";
import { mergeSettings } from "../src/lib/settings.ts";

export const env = (k, ...alt) => { for (const n of [k, ...alt]) if (process.env[n]) return process.env[n]; return ""; };

export function requireEnv(vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (!v) { console.error(`ينقص السر ${k} (Settings ← Secrets and variables ← Actions)`); process.exit(1); }
  }
}

export function adminClient() {
  const url = env("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  requireEnv({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** كل سطور جدول على دفعات. */
export async function all(sb, table) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadTables(sb, names, quiet = false) {
  const tables = {};
  for (const t of names) {
    tables[t] = await all(sb, t);
    if (!quiet) console.log(`${t}: ${tables[t].length} سطر`);
  }
  return tables;
}

/** الوقت الحالي بتوقيت بيروت (يحسب التوقيت الصيفي تلقائياً). */
export function beirutNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), hhmm: `${p.hour}:${p.minute}` };
}

/** إعدادات وأوزان المواد لكل أستاذ (حساب). */
export function settingsByOwner(tables) {
  const settingsOf = new Map();
  const weightsOf = new Map();
  const owners = new Set(tables.settings.map((r) => r.owner_id).concat(tables.classes.map((c) => c.owner_id)));
  for (const owner of owners) {
    const rows = tables.settings.filter((r) => r.owner_id === owner);
    settingsOf.set(owner, mergeSettings(Object.fromEntries(rows.map((r) => [r.key, r.value]))));
    const w = {};
    for (const r of rows) if (r.key.startsWith("subject:")) w[r.key.slice(8)] = r.value;
    weightsOf.set(owner, w);
  }
  return { settingsOf, weightsOf };
}

/** بيانات التنبيهات لأستاذ واحد (نفس ما يحسبه الموقع). */
export function alertDataFor(owner, tables, weightsOf) {
  const own = (t) => tables[t].filter((x) => x.owner_id === owner);
  return {
    classes: own("classes").filter((c) => !c.deleted_at && !c.archived),
    students: own("students"),
    subjects: own("subjects"),
    slots: own("schedule_slots"),
    sessions: own("sessions"),
    records: own("session_records"),
    grades: own("grade_entries"),
    assignments: own("assignments").filter((x) => !x.deleted_at),
    submissions: own("assignment_submissions"),
    dates: own("assessment_dates"),
    weights: weightsOf.get(owner) ?? {},
  };
}
