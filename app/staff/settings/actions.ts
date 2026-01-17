"use server";

import { prisma } from "@/lib/db";
import { requireStaffPageContext } from "../lib";

function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

export async function saveStaffSchedule(formData: FormData) {
  const ctx = await requireStaffPageContext();
  if (!ctx.staff) {
    return { ok: false, error: "Staff record not linked" } as const;
  }

  const updates = Array.from({ length: 7 }).map((_, day) => {
    const start = String(formData.get(`day-${day}-start`) || "").trim();
    const end = String(formData.get(`day-${day}-end`) || "").trim();
    return { day, start, end };
  });

  await prisma.$transaction(async (tx) => {
    for (const row of updates) {
      if (row.start && row.end && isValidTime(row.start) && isValidTime(row.end)) {
        await tx.staffSchedule.upsert({
          where: { staffId_dayOfWeek: { staffId: ctx.staff!.id, dayOfWeek: row.day } },
          update: { startTime: row.start, endTime: row.end },
          create: { staffId: ctx.staff!.id, dayOfWeek: row.day, startTime: row.start, endTime: row.end },
        });
      } else {
        await tx.staffSchedule.deleteMany({
          where: { staffId: ctx.staff!.id, dayOfWeek: row.day },
        });
      }
    }
  });

  return { ok: true } as const;
}
