"use client";
import { Suspense } from "react";
import { WeekSchedule } from "@/components/week-schedule";
import { Spinner } from "@/components/ui";

export default function SchedulePage() {
  return <Suspense fallback={<Spinner />}><WeekSchedule /></Suspense>;
}
