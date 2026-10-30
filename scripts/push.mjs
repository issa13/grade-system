// إشعارات على التلفون — تعمل كل ساعة على GitHub Actions (.github/workflows/push.yml)
// تحسب التنبيهات (نفس محرك الموقع)، وترسل الجديدة منها إلى أجهزة الأستاذ عبر Web Push.
// تُشغّل بـ: npx tsx scripts/push.mjs        (أو --test لإرسال إشعار تجربة لكل الأجهزة)
//                                            (أو --dry-run للحساب بدون إرسال)
// المستودع عام: السجل لا يطبع أي اسم أو علامة، فقط أعداد.

import webpush from "web-push";
import { computeAlerts, groupAlerts, visibleAlerts } from "../src/lib/alerts.ts";
import { adminClient, alertDataFor, beirutNow, env, loadTables, requireEnv, settingsByOwner } from "./shared.mjs";

const TEST = process.argv.includes("--test");
const DRY = process.argv.includes("--dry-run");
const PUB = env("VAPID_PUBLIC_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY");
const PRIV = env("VAPID_PRIVATE_KEY");
if (!DRY) requireEnv({ VAPID_PUBLIC_KEY: PUB, VAPID_PRIVATE_KEY: PRIV });
if (!DRY) webpush.setVapidDetails(`mailto:${env("VAPID_SUBJECT", "SMTP_USER") || "teacher@example.com"}`, PUB, PRIV);

const sb = adminClient();
const now = beirutNow();
const tables = await loadTables(sb, [
  "push_subscriptions", "push_sent", "settings", "classes", "students", "subjects", "schedule_slots", "sessions",
  "session_records", "grade_entries", "assignments", "assignment_submissions", "assessment_dates", "alert_states",
], true);
const { settingsOf, weightsOf } = settingsByOwner(tables);
console.log(`الأجهزة: ${tables.push_subscriptions.length} · الوقت (بيروت): ${now.date} ${now.hhmm}`);

const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** هل الآن ضمن ساعات الهدوء؟ (مثلاً 20:00 ← 07:00 تمرّ بمنتصف الليل) */
function quiet(p) {
  const a = toMin(p.quiet_from), b = toMin(p.quiet_to);
  if (a === null || b === null || a === b) return false;
  return a < b ? now.minutes >= a && now.minutes < b : now.minutes >= a || now.minutes < b;
}

/** الرابط الذي يفتحه الإشعار (نسبةً إلى الموقع). */
function urlFor(items) {
  if (items.length !== 1) return "?alerts=1";
  const i = items[0];
  const path = i.href.replace(/^\//, "");
  if (!i.create) return path;
  // حصة لم تُنشأ بعد: صفحة الحصة تنشئها بنفس المعرّف
  return `${path}&slot=${i.create.schedule_slot_id}&date=${i.create.date}&subject=${i.create.subject_id}`;
}

let sent = 0, failed = 0, removed = 0, skippedQuiet = 0;
const dead = new Set(); // أجهزة حُذفت في هذه المرة: لا نحاول الإرسال إليها مجدداً

async function deliver(sub, payload) {
  if (dead.has(sub.id)) return false;
  if (DRY) return true;
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "normal" });
    sent++;
    await sb.from("push_subscriptions").update({ last_ok_at: new Date().toISOString(), failures: 0 }).eq("id", sub.id);
    return true;
  } catch (e) {
    failed++;
    const code = e?.statusCode;
    // 404/410 = الجهاز ألغى الاشتراك (حُذف التطبيق أو أُوقفت الإشعارات): نحذفه
    if (code === 404 || code === 410 || (sub.failures ?? 0) >= 9) {
      await sb.from("push_subscriptions").delete().eq("id", sub.id);
      dead.add(sub.id);
      removed++;
    } else {
      sub.failures = (sub.failures ?? 0) + 1;
      await sb.from("push_subscriptions").update({ failures: sub.failures }).eq("id", sub.id);
    }
    console.log(`فشل إرسال إلى جهاز (HTTP ${code ?? "?"})`);
    return false;
  }
}

const owners = new Set(tables.push_subscriptions.map((s) => s.owner_id));
for (const owner of owners) {
  const subs = tables.push_subscriptions.filter((s) => s.owner_id === owner);
  const s = settingsOf.get(owner);
  if (!s) continue;
  const P = s.push;

  if (TEST) {
    for (const sub of subs) await deliver(sub, { title: "تجربة ✓", body: "الإشعارات تصل إلى هذا الجهاز من GitHub.", url: "", tag: "test" });
    continue;
  }
  const weekday = new Date(`${now.date}T12:00:00Z`).getUTCDay();
  if (P.weekend_off && s.year.weekend_days.includes(weekday)) { skippedQuiet++; continue; }
  if (quiet(P)) { skippedQuiet++; continue; } // تُرسل بعد انتهاء ساعات الهدوء (لم تُسجّل كمرسلة)

  const rules = new Set(P.rules ?? []);
  const states = tables.alert_states.filter((x) => x.owner_id === owner);
  const current = visibleAlerts(computeAlerts(alertDataFor(owner, tables, weightsOf), s, now.date), states, now.date)
    .filter((i) => rules.has(i.rule));
  const sentBefore = new Map(tables.push_sent.filter((x) => x.owner_id === owner).map((x) => [x.key, x.fingerprint]));
  const fresh = current.filter((i) => sentBefore.get(i.key) !== i.fingerprint);

  // تنظيف: تنبيهات لم تعد موجودة (حُلّت) تُحذف من سجل المرسل
  const live = new Set(current.map((i) => i.key));
  const stale = [...sentBefore.keys()].filter((k) => !live.has(k));
  if (stale.length && !DRY) for (let i = 0; i < stale.length; i += 200) await sb.from("push_sent").delete().eq("owner_id", owner).in("key", stale.slice(i, i + 200));

  const groups = groupAlerts(fresh, s).slice(0, Math.max(1, P.max_per_run));
  for (const g of groups) {
    const body = g.items.slice(0, 3).map((i) => `• ${i.label}${i.detail && i.rule !== "unlogged" ? ` (${i.detail})` : ""}`).join("\n") + (g.items.length > 3 ? `\n… و${g.items.length - 3} أخرى` : "");
    const payload = { title: g.title, body, url: urlFor(g.items), tag: g.rule };
    let ok = false;
    for (const sub of subs) ok = (await deliver(sub, payload)) || ok;
    // تُسجّل كمرسلة فقط إذا وصلت إلى جهاز واحد على الأقل (وإلا نحاول في الساعة التالية)
    if (ok && !DRY) {
      const rows = g.items.map((i) => ({ owner_id: owner, key: i.key, fingerprint: i.fingerprint, sent_at: new Date().toISOString() }));
      const { error } = await sb.from("push_sent").upsert(rows, { onConflict: "owner_id,key" });
      if (error) console.log("تعذّر تسجيل المرسل:", error.message);
    }
  }
  console.log(`حساب: ${current.length} تنبيه مختار، ${fresh.length} جديد، ${groups.length} إشعار`);
}
console.log(`النتيجة: أُرسل ${sent} · فشل ${failed} · حُذف ${removed} جهاز · مؤجل (هدوء/عطلة) ${skippedQuiet}${DRY ? " · تجربة بدون إرسال" : ""}`);
if (failed && !sent && !DRY) process.exitCode = 1; // يرسل GitHub إيميلاً إذا فشل كل شيء
