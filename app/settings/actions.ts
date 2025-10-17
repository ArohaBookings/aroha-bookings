// app/settings/actions.ts
"use server";

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/* ───────────────────────────────────────────────────────────────
   Public types (match your client expectations)
   ─────────────────────────────────────────────────────────────── */
export type OpeningHoursRow = {
  weekday: number;   // 0=Sun..6=Sat
  openMin: number;
  closeMin: number;
  closed?: boolean;
};

export type ServiceIn = {
  id?: string;                 // UI temp id is fine
  name: string;
  durationMin: number;
  priceCents: number;
  colorHex?: string | null;
};

export type StaffIn = {
  id?: string;                 // UI temp id is fine
  name: string;
  email?: string | null;
  active: boolean;
  colorHex?: string | null;
  serviceIds: string[];        // UI service ids (temp)
};

export type RosterCell = { start: string; end: string };
export type Roster = Record<string, RosterCell[]>; // key = staff temp id (or real id)

export type SettingsPayload = {
  business: {
    name: string;
    timezone: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  openingHours: OpeningHoursRow[];

  services?: ServiceIn[];   // optional replace-all
  staff?: StaffIn[];        // optional replace-all
  roster?: Roster;          // optional; 0=Sun..6=Sat

  bookingRules: unknown;
  notifications: unknown;
  onlineBooking: unknown;
  calendarPrefs: unknown;
};

export type SaveResponse = { ok: true } | { ok: false; error: string };

/* ───────────────────────────────────────────────────────────────
   Internal light DB shapes (avoid importing Prisma types)
   ─────────────────────────────────────────────────────────────── */
type OpeningRowDB = { weekday: number; openMin: number; closeMin: number };
type ServiceDB    = { id: string; name: string; durationMin: number; priceCents: number; colorHex: string | null };
type StaffDB      = { id: string; name: string; email: string | null; active: boolean; colorHex: string | null };
type ScheduleDB   = { staffId: string; dayOfWeek: number; startTime: string; endTime: string };
type StaffSvcDB   = { staffId: string; serviceId: string };

/* ───────────────────────────────────────────────────────────────
   Auth / org helper
   ─────────────────────────────────────────────────────────────── */
async function requireOrg() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/api/auth/signin");

  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { memberships: { include: { org: true } } },
  });

  const org = me?.memberships?.[0]?.org;
  if (!org) redirect("/onboarding");
  return org;
}

/* ───────────────────────────────────────────────────────────────
   LOAD: hydrate Settings with real DB state
   ─────────────────────────────────────────────────────────────── */
export async function loadAllSettings(): Promise<{
  business: SettingsPayload["business"];
  openingHours: OpeningHoursRow[];
  services: (ServiceIn & { id: string })[];
  staff: (StaffIn & { id: string })[];
  roster: Roster;
  bookingRules: unknown;
  notifications: unknown;
  onlineBooking: unknown;
  calendarPrefs: unknown;
}> {
  const org = await requireOrg();

  const [orgRow, openingRows, services, staff, schedules, links] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: { name: true, timezone: true, address: true, dashboardConfig: true },
    }),
    prisma.openingHours.findMany({
      where: { orgId: org.id },
      orderBy: { weekday: "asc" },
    }),
    prisma.service.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
    }),
    prisma.staffMember.findMany({
      where: { orgId: org.id },
      orderBy: { name: "asc" },
    }),
    prisma.staffSchedule.findMany({
      where: { staff: { orgId: org.id } },
      orderBy: [{ staffId: "asc" }, { dayOfWeek: "asc" }],
    }),
    prisma.staffService.findMany({
      where: { staff: { orgId: org.id } },
    }),
  ]);

  // Build roster (DB 0=Sun..6=Sat)
  const roster: Roster = {};
  const schedulesByStaff = new Map<string, RosterCell[]>();
  for (const s of staff as StaffDB[]) {
    schedulesByStaff.set(s.id, Array.from({ length: 7 }, () => ({ start: "", end: "" })));
  }
  for (const sc of schedules as ScheduleDB[]) {
    const arr = schedulesByStaff.get(sc.staffId);
    if (arr) arr[sc.dayOfWeek] = { start: sc.startTime, end: sc.endTime };
  }
  for (const s of staff as StaffDB[]) roster[s.id] = schedulesByStaff.get(s.id)!;

  // Build service links per staff
  const linksByStaff = new Map<string, string[]>();
  for (const s of staff as StaffDB[]) linksByStaff.set(s.id, []);
  for (const l of links as StaffSvcDB[]) linksByStaff.get(l.staffId)?.push(l.serviceId);

  return {
    business: {
      name: orgRow?.name ?? "",
      timezone: orgRow?.timezone ?? "Pacific/Auckland",
      address: orgRow?.address ?? "",
      phone: (orgRow?.dashboardConfig as any)?.contact?.phone ?? "",
      email: (orgRow?.dashboardConfig as any)?.contact?.email ?? "",
    },
    openingHours: (openingRows as OpeningRowDB[]).map(
      (h: OpeningRowDB): OpeningHoursRow => ({
        weekday: h.weekday,
        openMin: h.openMin,
        closeMin: h.closeMin,
        closed: h.openMin === 0 && h.closeMin === 0,
      })
    ),
    services: (services as ServiceDB[]).map(
      (s: ServiceDB): ServiceIn & { id: string } => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
        colorHex: s.colorHex ?? "#DBEAFE",
      })
    ),
    staff: (staff as StaffDB[]).map(
      (s: StaffDB): StaffIn & { id: string } => ({
        id: s.id,
        name: s.name,
        email: s.email ?? undefined,
        active: s.active,
        colorHex: s.colorHex ?? "#10B981",
        serviceIds: linksByStaff.get(s.id) ?? [],
      })
    ),
    roster,
    bookingRules: (orgRow?.dashboardConfig as any)?.bookingRules ?? {},
    notifications: (orgRow?.dashboardConfig as any)?.notifications ?? {},
    onlineBooking: (orgRow?.dashboardConfig as any)?.onlineBooking ?? {},
    calendarPrefs: (orgRow?.dashboardConfig as any)?.calendarPrefs ?? {},
  };
}

/* ───────────────────────────────────────────────────────────────
   SAVE: persist everything (replace-all semantics where provided)
   ─────────────────────────────────────────────────────────────── */
export async function saveAllSettings(payload: SettingsPayload): Promise<SaveResponse> {
  try {
    const org = await requireOrg();

    // Copies for mapping
    const servicesIn: ServiceIn[] = payload.services ?? [];
    const staffIn:    StaffIn[]    = payload.staff ?? [];
    const rosterIn:   Roster       = payload.roster ?? {};

    // temp service/staff id -> name (from client)
    const tempServiceIdToName = new Map<string, string>();
    for (const s of servicesIn) if (s.id) tempServiceIdToName.set(s.id, s.name);

    const tempStaffIdToName = new Map<string, string>();
    for (const s of staffIn) if (s.id) tempStaffIdToName.set(s.id, s.name);

    await prisma.$transaction(async (tx: any) => {
      // 1) Organization basics + JSON config
      const existing = await tx.organization.findUnique({
        where: { id: org.id },
        select: { dashboardConfig: true },
      });
      const mergedConfig = {
        ...(existing?.dashboardConfig as any),
        bookingRules: payload.bookingRules,
        notifications: payload.notifications,
        onlineBooking: payload.onlineBooking,
        calendarPrefs: payload.calendarPrefs,
        contact: { phone: payload.business.phone ?? "", email: payload.business.email ?? "" },
      };

      await tx.organization.update({
        where: { id: org.id },
        data: {
          name: payload.business.name,
          timezone: payload.business.timezone,
          address: payload.business.address ?? null,
          dashboardConfig: mergedConfig,
        },
      });

      // 2) Opening hours (replace-all)
      if (payload.openingHours?.length) {
        const cleaned = payload.openingHours.map((h: OpeningHoursRow) => ({
          weekday: h.weekday,
          openMin: h.closed ? 0 : h.openMin,
          closeMin: h.closed ? 0 : h.closeMin,
        }));
        await tx.openingHours.deleteMany({ where: { orgId: org.id } });
        await tx.openingHours.createMany({
          data: cleaned.map((r) => ({ orgId: org.id, ...r })),
        });
      }

      // 3) Services (replace-all if provided)
      let serviceIdByName = new Map<string, string>();
      if (servicesIn.length) {
        await tx.staffService.deleteMany({ where: { service: { orgId: org.id } } });
        await tx.service.deleteMany({ where: { orgId: org.id } });
        await tx.service.createMany({
          data: servicesIn.map((s: ServiceIn) => ({
            orgId: org.id,
            name: s.name,
            durationMin: s.durationMin,
            priceCents: s.priceCents,
            colorHex: s.colorHex ?? null,
          })),
        });
      }
      {
        // refresh name->id map (works whether or not we replaced)
        const fresh: ServiceDB[] = await tx.service.findMany({ where: { orgId: org.id } });
        serviceIdByName = new Map<string, string>(fresh.map((s: ServiceDB) => [s.name, s.id]));
      }

      const toRealServiceId = (tempId: string): string | undefined => {
        const name = tempServiceIdToName.get(tempId);
        return name ? serviceIdByName.get(name) : undefined;
        // if payload staff already uses real ids, they will pass through below
      };

      // 4) Staff (replace-all if provided)
      const realStaffIdByTempId = new Map<string, string>();
      if (staffIn.length) {
        await tx.staffSchedule.deleteMany({ where: { staff: { orgId: org.id } } });
        await tx.staffService.deleteMany({ where: { staff: { orgId: org.id } } });
        await tx.staffMember.deleteMany({ where: { orgId: org.id } });

        for (const s of staffIn as StaffIn[]) {
          const created: StaffDB = await tx.staffMember.create({
            data: {
              orgId: org.id,
              name: s.name,
              email: s.email ?? null,
              active: s.active,
              colorHex: s.colorHex ?? null,
            },
          });
          if (s.id) realStaffIdByTempId.set(s.id, created.id);

          if (s.serviceIds?.length) {
            const linkData = s.serviceIds
              .map((tmp: string) => toRealServiceId(tmp) ?? tmp) // tmp might already be real id
              .filter((id: string | undefined): id is string => Boolean(id))
              .map((serviceId: string) => ({ staffId: created.id, serviceId }));

            if (linkData.length) {
              await tx.staffService.createMany({ data: linkData, skipDuplicates: true });
            }
          }
        }
      } else {
        // build map so roster can resolve temp ids by staff name
        const existingStaff: StaffDB[] = await tx.staffMember.findMany({ where: { orgId: org.id } });
        for (const st of existingStaff) {
          for (const [tid, nm] of tempStaffIdToName) {
            if (nm === st.name) realStaffIdByTempId.set(tid, st.id);
          }
        }
      }

      // 5) Roster (Sun..Sat). If any roster provided, wipe & insert for those staff.
      if (Object.keys(rosterIn).length) {
        await tx.staffSchedule.deleteMany({ where: { staff: { orgId: org.id } } });

        const rows: { staffId: string; dayOfWeek: number; startTime: string; endTime: string }[] = [];
        for (const [tempStaffId, week] of Object.entries(rosterIn) as [string, (RosterCell | undefined)[]][]) {
          const realId = realStaffIdByTempId.get(tempStaffId) ?? tempStaffId; // allow real id passthrough
          if (!realId) continue;

          week.forEach((cell: RosterCell | undefined, dayIdx: number) => {
            if (!cell?.start || !cell?.end) return;
            rows.push({
              staffId: realId,
              dayOfWeek: dayIdx, // already 0..6 (Sun..Sat)
              startTime: cell.start,
              endTime: cell.end,
            });
          });
        }

        if (rows.length) {
          await tx.staffSchedule.createMany({ data: rows });
        }
      }
    });

    return { ok: true };
  } catch (err: any) {
    console.error("saveAllSettings failed:", err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
