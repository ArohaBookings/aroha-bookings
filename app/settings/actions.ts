"use server";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/* ───────────────────────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────────────────────── */
async function requireOrg() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });

  const org = user?.memberships?.[0]?.org;
  if (!org) redirect("/onboarding");
  return org; // { id, name, slug, timezone, ... }
}

/* If you’re using zod, import your schemas; otherwise keep these minimal types */
type OrgInput = { name: string; timezone: string };
type StaffInput = {
  name: string;
  email?: string | null;
  active: boolean;
  colorHex?: string | null;
  serviceIds?: string[];
};
type ServiceInput = {
  name: string;
  durationMin: number;
  priceCents: number;
  colorHex?: string | null;
};
type OpeningHoursRow = { weekday: number; openMin: number; closeMin: number; closed?: boolean };
type RosterCell = { start: string; end: string };
type Roster = Record<string, RosterCell[]>;

export type SettingsPayload = {
  business: OrgInput & { address?: string; phone?: string; email?: string };
  openingHours: OpeningHoursRow[];
  // The next three are optional so page.tsx can omit them for now
  services?: (ServiceInput & { id?: string })[];
  staff?: (StaffInput & { id?: string })[];
  roster?: Roster;
  bookingRules: unknown;
  notifications: unknown;
  onlineBooking: unknown;
  calendarPrefs: unknown;
};

export type SaveResponse = { ok: boolean; error?: string };

/* ───────────────────────────────────────────────────────────────
   ORG
   ─────────────────────────────────────────────────────────────── */
export async function saveOrg(input: OrgInput) {
  const org = await requireOrg();
  const updated = await prisma.organization.update({
    where: { id: org.id },
    data: { name: input.name, timezone: input.timezone },
  });
  return { ok: true as const, org: updated };
}

/* ───────────────────────────────────────────────────────────────
   STAFF
   ─────────────────────────────────────────────────────────────── */
export async function createStaff(input: StaffInput) {
  const org = await requireOrg();
  const staff = await prisma.staffMember.create({
    data: {
      orgId: org.id,
      name: input.name,
      email: input.email ?? null,
      active: input.active,
      colorHex: input.colorHex ?? null,
    },
  });

  if (input.serviceIds?.length) {
    await prisma.staffService.createMany({
      data: input.serviceIds.map((serviceId) => ({ staffId: staff.id, serviceId })),
      skipDuplicates: true,
    });
  }

  return { ok: true as const, staff };
}

export async function updateStaff(id: string, input: StaffInput) {
  const org = await requireOrg();

  const staff = await prisma.staffMember.update({
    where: { id },
    data: {
      name: input.name,
      email: input.email ?? null,
      active: input.active,
      colorHex: input.colorHex ?? null,
    },
  });

  if (Array.isArray(input.serviceIds)) {
    await prisma.$transaction([
      prisma.staffService.deleteMany({ where: { staffId: id } }),
      prisma.staffService.createMany({
        data: input.serviceIds.map((serviceId) => ({ staffId: id, serviceId })),
        skipDuplicates: true,
      }),
    ]);
  }

  return { ok: true as const, staff, orgId: org.id };
}

export async function deleteStaff(id: string) {
  await requireOrg();
  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { staffId: id } }),
    prisma.staffSchedule.deleteMany({ where: { staffId: id } }),
    prisma.appointment.updateMany({ where: { staffId: id }, data: { staffId: null } }),
    prisma.staffMember.delete({ where: { id } }),
  ]);
  return { ok: true as const };
}

/* ───────────────────────────────────────────────────────────────
   SERVICES
   ─────────────────────────────────────────────────────────────── */
export async function createService(input: ServiceInput) {
  const org = await requireOrg();
  const service = await prisma.service.create({
    data: {
      orgId: org.id,
      name: input.name,
      durationMin: input.durationMin,
      priceCents: input.priceCents,
      colorHex: input.colorHex ?? null,
    },
  });
  return { ok: true as const, service };
}

export async function updateService(id: string, input: ServiceInput) {
  await requireOrg();
  const service = await prisma.service.update({
    where: { id },
    data: {
      name: input.name,
      durationMin: input.durationMin,
      priceCents: input.priceCents,
      colorHex: input.colorHex ?? null,
    },
  });
  return { ok: true as const, service };
}

export async function deleteService(id: string) {
  await requireOrg();
  await prisma.$transaction([
    prisma.staffService.deleteMany({ where: { serviceId: id } }),
    prisma.appointment.updateMany({ where: { serviceId: id }, data: { serviceId: null } }),
    prisma.service.delete({ where: { id } }),
  ]);
  return { ok: true as const };
}

/* ───────────────────────────────────────────────────────────────
   OPENING HOURS
   ─────────────────────────────────────────────────────────────── */
export async function saveOpeningHours(rows: OpeningHoursRow[]) {
  const org = await requireOrg();

  const cleaned = rows.map((r) => ({
    weekday: r.weekday,
    openMin: r.closed ? 0 : r.openMin,
    closeMin: r.closed ? 0 : r.closeMin,
  }));

  await prisma.$transaction([
    prisma.openingHours.deleteMany({ where: { orgId: org.id } }),
    prisma.openingHours.createMany({ data: cleaned.map((r) => ({ orgId: org.id, ...r })) }),
  ]);

  return { ok: true as const };
}

/* ───────────────────────────────────────────────────────────────
   ROSTER → StaffSchedule
   ─────────────────────────────────────────────────────────────── */
export async function saveRoster(roster: Roster) {
  await requireOrg();

  const tx: Prisma.PrismaPromise<unknown>[] = [];

  for (const [staffId, days] of Object.entries(roster)) {
    tx.push(prisma.staffSchedule.deleteMany({ where: { staffId } }));
    for (let i = 0; i < days.length; i++) {
      const cell = days[i];
      if (!cell?.start || !cell?.end) continue;
      tx.push(
        prisma.staffSchedule.create({
          data: { staffId, dayOfWeek: i, startTime: cell.start, endTime: cell.end },
        })
      );
    }
  }

  if (tx.length) await prisma.$transaction(tx);
  return { ok: true as const };
}

/* ───────────────────────────────────────────────────────────────
   ALL SETTINGS (1-click Save)
   ─────────────────────────────────────────────────────────────── */
export async function saveAllSettings(payload: SettingsPayload): Promise<SaveResponse> {
  try {
    const org = await requireOrg();

    // 1) org basics + dump JSON config
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        name: payload.business.name,
        timezone: payload.business.timezone,
        address: payload.business.address ?? null,
        dashboardConfig: {
          ...(org.dashboardConfig as any),
          bookingRules: payload.bookingRules,
          notifications: payload.notifications,
          onlineBooking: payload.onlineBooking,
          calendarPrefs: payload.calendarPrefs,
          contact: { phone: payload.business.phone ?? "", email: payload.business.email ?? "" },
        },
      },
    });

    // 2) opening hours
    if (payload.openingHours?.length) {
      await saveOpeningHours(payload.openingHours);
    }

    // 3) services (optional replace-all)
    if (payload.services) {
      await prisma.$transaction([
        prisma.staffService.deleteMany({ where: { service: { orgId: org.id } } }),
        prisma.service.deleteMany({ where: { orgId: org.id } }),
        prisma.service.createMany({
          data: payload.services.map((s) => ({
            orgId: org.id,
            name: s.name,
            durationMin: s.durationMin,
            priceCents: s.priceCents,
            colorHex: s.colorHex ?? null,
          })),
        }),
      ]);
    }

    // 4) staff (optional replace-all)
    if (payload.staff) {
      await prisma.$transaction([
        prisma.staffSchedule.deleteMany({ where: { staff: { orgId: org.id } } }),
        prisma.staffService.deleteMany({ where: { staff: { orgId: org.id } } }),
        prisma.staffMember.deleteMany({ where: { orgId: org.id } }),
      ]);

      for (const st of payload.staff) {
        const created = await prisma.staffMember.create({
          data: {
            orgId: org.id,
            name: st.name,
            email: st.email ?? null,
            active: st.active,
            colorHex: st.colorHex ?? null,
          },
        });

        const linkIds = st.serviceIds?.length ? st.serviceIds : [];
        if (linkIds.length) {
          await prisma.staffService.createMany({
            data: linkIds.map((sid) => ({ staffId: created.id, serviceId: sid })),
            skipDuplicates: true,
          });
        }
      }
    }

    // 5) roster (optional)
    if (payload.roster && Object.keys(payload.roster).length) {
      await saveRoster(payload.roster);
    }

    return { ok: true };
  } catch (err: any) {
    console.error("saveAllSettings failed:", err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
