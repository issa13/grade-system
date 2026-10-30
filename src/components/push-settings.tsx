"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { currentSubscription, disablePush, enablePush, localTest, pushSupport, type PushSupport } from "@/lib/push";
import { friendly, logError } from "@/lib/errors";
import { Info } from "./info";
import { Button, cx, useToast } from "./ui";

type Device = { id: string; endpoint: string; device: string | null; created_at: string; last_ok_at: string | null; failures: number };

const MSG: Record<Exclude<PushSupport, "ok">, string> = {
  "no-key": "الإشعارات غير مفعّلة في هذا الموقع بعد: أضف المتغير NEXT_PUBLIC_VAPID_PUBLIC_KEY على GitHub ثم أعد النشر (الشرح في README ← الإشعارات).",
  dev: "الإشعارات تعمل فقط في الموقع المنشور (ليس في npm run dev).",
  unsupported: "هذا المتصفح لا يدعم الإشعارات. على أندرويد استعمل Chrome، وعلى الكمبيوتر Chrome أو Edge.",
  "ios-install": "على الآيفون: أضف الموقع إلى الشاشة الرئيسية أولاً (Safari ← مشاركة ← «إضافة إلى الشاشة الرئيسية»)، ثم افتحه من الأيقونة وفعّل الإشعارات من هنا. يحتاج iOS 16.4 أو أحدث.",
};

/** تفعيل الإشعارات على هذا الجهاز + قائمة الأجهزة المفعّلة. */
export function PushDevices() {
  const toast = useToast();
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [mine, setMine] = useState<string | null>(null); // endpoint هذا الجهاز
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState<NotificationPermission | null>(null);

  const load = useCallback(async () => {
    setSupport(pushSupport());
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
    setMine((await currentSubscription())?.endpoint ?? null);
    const { data, error } = await supabase().from("push_subscriptions").select("id,endpoint,device,created_at,last_ok_at,failures").order("created_at");
    if (error) { logError(error.message, "push"); setDevices([]); return; }
    setDevices((data ?? []) as Device[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const enabledHere = !!mine && !!devices?.some((d) => d.endpoint === mine);

  async function enable() {
    setBusy(true);
    try {
      await enablePush();
      toast({ text: "فُعّلت الإشعارات على هذا الجهاز", kind: "ok" });
      await localTest().catch(() => {});
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      toast({ text: m === "denied" ? "رفضت الإذن. افتح إعدادات الموقع في المتصفح واسمح بالإشعارات، ثم حاول مجدداً." : m === "dismissed" ? "لم تُعطِ الإذن." : friendly(e), kind: "err" });
      logError(e, "push");
    }
    setBusy(false);
    load();
  }
  async function disable() {
    setBusy(true);
    try { await disablePush(); toast({ text: "أُوقفت الإشعارات على هذا الجهاز", kind: "ok" }); } catch (e) { toast({ text: friendly(e), kind: "err" }); }
    setBusy(false);
    load();
  }
  async function remove(d: Device) {
    const { error } = await supabase().from("push_subscriptions").delete().eq("id", d.id);
    if (error) return toast({ text: friendly(error), kind: "err" });
    load();
  }

  return (
    <div className="mb-6 space-y-3 border-b border-zinc-100 pb-6 dark:border-zinc-800">
      <div className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <b>هذا الجهاز:</b>
          {support === null ? "…" : support !== "ok" ? <span className="text-amber-700 dark:text-amber-400">غير متاح</span>
            : enabledHere ? <span className="text-green-700 dark:text-green-400">✓ الإشعارات مفعّلة</span>
            : perm === "denied" ? <span className="text-red-600">الإذن مرفوض في المتصفح</span>
            : <span className="text-zinc-500">غير مفعّلة</span>}
          <div className="flex-1" />
          {support === "ok" && (enabledHere ? (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => localTest().then(() => toast({ text: "أُرسل إشعار تجربة", kind: "ok" })).catch((e) => toast({ text: friendly(e), kind: "err" }))}>إشعار تجربة</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={disable}>إيقاف على هذا الجهاز</Button>
            </>
          ) : <Button size="sm" disabled={busy} onClick={enable}>🔔 تفعيل الإشعارات على هذا الجهاز</Button>)}
        </div>
        {support && support !== "ok" && <p className="text-xs leading-6 text-zinc-600 dark:text-zinc-400">{MSG[support]}</p>}
        {support === "ok" && perm === "denied" && <p className="text-xs leading-6 text-zinc-600 dark:text-zinc-400">اضغط على القفل 🔒 بجانب عنوان الموقع ← الإشعارات ← السماح، ثم «تفعيل».</p>}
      </div>

      <div className="text-sm">
        <div className="mb-1 flex items-center font-medium">الأجهزة المفعّلة ({devices?.length ?? 0})
          <Info title="الأجهزة المفعّلة">كل جهاز فعّلت عليه الإشعارات. «آخر وصول» = آخر إشعار وصل بنجاح. الجهاز الذي يفشل عدة مرات (مثلاً حُذف التطبيق) يُحذف تلقائياً.</Info>
        </div>
        {devices && devices.length === 0 && <p className="text-xs text-zinc-500">لا يوجد جهاز بعد.</p>}
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {devices?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className={cx("flex-1", d.endpoint === mine && "font-semibold")}>{d.device || "جهاز"}{d.endpoint === mine && " (هذا الجهاز)"}</span>
              <span className="text-xs text-zinc-500">{d.last_ok_at ? `آخر وصول ${new Date(d.last_ok_at).toLocaleString("ar-LB")}` : "لم يصل إشعار بعد"}{d.failures ? ` · فشل ${d.failures}` : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => remove(d)}>حذف</Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
