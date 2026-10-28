"use client";
import { Suspense } from "react";
import { useSettings } from "@/components/settings-provider";
import { ClassesList } from "@/components/classes-list";
import { WeekSchedule } from "@/components/week-schedule";
import { Spinner } from "@/components/ui";

/** الصفحة الرئيسية: البرنامج الأسبوعي (أو قائمة الصفوف حسب الإعدادات ← البرنامج الأسبوعي). */
export default function Home() {
  const { settings, loaded } = useSettings();
  if (!loaded) return <Spinner />;
  if (settings.schedule.home === "classes") return <ClassesList />;
  return <Suspense fallback={<Spinner />}><WeekSchedule /></Suspense>;
}
