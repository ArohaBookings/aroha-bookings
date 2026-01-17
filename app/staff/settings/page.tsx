// app/staff/settings/page.tsx
import React from "react";
import { prisma } from "@/lib/db";
import { requireStaffPageContext } from "../lib";
import { saveStaffSchedule } from "./actions";
import { Button, Card, Input } from "@/components/ui";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function LinkRequired() {
  return (
    <main className="min-h-screen bg-zinc-50 flex items-center justify-center px-6">
      <Card className="max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold text-zinc-900">Staff settings</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Your account isn’t linked to a staff profile yet. Ask an admin to connect your email to a staff member.
        </p>
      </Card>
    </main>
  );
}

export default async function StaffSettingsPage() {
  const ctx = await requireStaffPageContext();
  if (!ctx.staff) return <LinkRequired />;

  const schedules = await prisma.staffSchedule.findMany({
    where: { staffId: ctx.staff.id },
    select: { dayOfWeek: true, startTime: true, endTime: true },
  });

  const byDay = new Map<number, { start: string; end: string }>();
  schedules.forEach((s) => byDay.set(s.dayOfWeek, { start: s.startTime, end: s.endTime }));

  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Staff portal</p>
          <h1 className="text-2xl font-semibold text-zinc-900 mt-2">Availability</h1>
          <p className="text-sm text-zinc-600">
            {ctx.org.name} · {ctx.staff.name}
          </p>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-6 py-8">
        <form
          action={async (formData: FormData) => {
            await saveStaffSchedule(formData);
          }}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        >

          <div className="grid gap-3">
            {DAYS.map((label, idx) => {
              const row = byDay.get(idx) || { start: "", end: "" };
              return (
                <div key={label} className="grid grid-cols-[80px_1fr_1fr] gap-3 items-center">
                  <span className="text-sm font-semibold text-zinc-700">{label}</span>
                  <Input
                    type="time"
                    name={`day-${idx}-start`}
                    defaultValue={row.start}
                    className="h-10 text-sm"
                  />
                  <Input
                    type="time"
                    name={`day-${idx}-end`}
                    defaultValue={row.end}
                    className="h-10 text-sm"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-6 flex items-center justify-end">
            <Button type="submit">Save availability</Button>
          </div>
        </form>
      </section>
    </main>
  );
}
