"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";

/** ───────────────────────────────
 *  Helper to ensure current org
 *  ─────────────────────────────── */
async function requireOrg() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });

  const org = user?.memberships[0]?.org;
  if (!org) redirect("/onboarding");
  return org;
}

/** ───────────────────────────────
 *  Booking management actions
 *  ─────────────────────────────── */

// Create new booking (used in ClientIslands → CreateForm)
export async function createBooking(formData: FormData) {
  const org = await requireOrg();
  try {
    const startsAt = new Date(String(formData.get("startsAt")));
    const duration = Number(formData.get("durationMin") || 30);
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    await prisma.appointment.create({
      data: {
        orgId: org.id,
        staffId: (formData.get("staffId") as string) || null,
        serviceId: (formData.get("serviceId") as string) || null,
        customerName: String(formData.get("customerName") || "Client"),
        customerPhone: String(formData.get("customerPhone") || ""),
        startsAt,
        endsAt,
        status: "SCHEDULED",
        source: "manual",
      },
    });

    return { ok: true as const };
  } catch (err: any) {
    console.error("Create booking failed:", err);
    return { ok: false as const, error: err.message };
  }
}

// Update existing booking (used in EditForm)
export async function updateBooking(formData: FormData) {
  await requireOrg();
  try {
    const id = String(formData.get("id"));
    const startsAt = new Date(String(formData.get("startsAt")));
    const duration = Number(formData.get("durationMin") || 30);
    const endsAt = new Date(startsAt.getTime() + duration * 60000);

    await prisma.appointment.update({
      where: { id },
      data: {
        startsAt,
        endsAt,
        staffId: (formData.get("staffId") as string) || null,
        serviceId: (formData.get("serviceId") as string) || null,
        customerName: String(formData.get("customerName") || "Client"),
        customerPhone: String(formData.get("customerPhone") || ""),
      },
    });

    return { ok: true as const };
  } catch (err: any) {
    console.error("Update booking failed:", err);
    return { ok: false as const, error: err.message };
  }
}

// Cancel a booking
export async function cancelBooking(formData: FormData) {
  await requireOrg();
  try {
    const id = String(formData.get("id"));
    await prisma.appointment.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "user" },
    });
    return { ok: true as const };
  } catch (err: any) {
    console.error("Cancel booking failed:", err);
    return { ok: false as const, error: err.message };
  }
}

// Quick status toggle (used internally or future UI)
export async function updateBookingStatus(
  id: string,
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"
) {
  await prisma.appointment.update({ where: { id }, data: { status } });
}

// Permanently delete
export async function deleteBooking(id: string) {
  await prisma.appointment.delete({ where: { id } });
}

// Duplicate booking +7 days ahead
export async function duplicateBooking(id: string) {
  const src = await prisma.appointment.findUnique({ where: { id } });
  if (!src) return;
  const plus7 = (d: Date) => new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000);
  await prisma.appointment.create({
    data: {
      orgId: src.orgId,
      staffId: src.staffId ?? undefined,
      serviceId: src.serviceId ?? undefined,
      customerName: src.customerName,
      customerPhone: src.customerPhone,
      startsAt: plus7(src.startsAt),
      endsAt: plus7(src.endsAt),
      source: src.source,
      status: "SCHEDULED",
    },
  });
}
