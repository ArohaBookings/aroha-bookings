// app/settings/actions.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
"use server";

/**
 * AROHA SETTINGS ACTIONS — STABLE EDITION
 * - Strong Zod validation
 * - One interactive transaction; no nested transactions
 * - All reads/writes use the same `tx`
 * - Idempotent upserts + precise diffs (no delete-all unless truly removed)
 * - 7 opening-hours rows guaranteed (0..6 Sun..Sat)
 * - Staff roster saved per day; invalid rows ignored safely
 * - Stable temp→real mapping for services & staff
 */

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { resolvePlanConfig } from "@/lib/plan";

/* ───────────────────────────────────────────────────────────────
   Public types (mirror client)
   ─────────────────────────────────────────────────────────────── */

export type OpeningHoursRow = {
  weekday: number; // 0=Sun..6=Sat
  openMin: number;
  closeMin: number;
  closed?: boolean;
};

export type ServiceIn = {
  id?: string; // temp or real
  name: string;
  durationMin: number;
  priceCents: number;
  colorHex?: string | null;
};

export type StaffIn = {
  id?: string; // temp or real
  name: string;
  email?: string | null;
  active: boolean;
  colorHex?: string | null;
  serviceIds: string[]; // temp or real ids
};

export type RosterCell = { start: string; end: string } | undefined; // undefined = no shift
export type Roster = Record<string, RosterCell[]>; // key=staff temp/real id; 7 entries

export type SettingsPayload = {
  business: {
    name: string;
    timezone: string;
    address?: string;
    phone?: string;
    email?: string;
    niche?: string;
  };
  openingHours: OpeningHoursRow[];

  services?: ServiceIn[];
  staff?: StaffIn[];
  roster?: Roster;

  bookingRules: unknown;
  notifications: unknown;
  onlineBooking: unknown;
  calendarPrefs: unknown;
  billing?: {
    managePlanUrl?: string;
  };
};

export type SaveResponse =
  | {
      ok: true;
      result: {
        organizationUpdated: boolean;
        openingHoursUpserted: number;
        servicesUpserted: number;
        servicesRemoved: number;
        staffUpserted: number;
        staffRemoved: number;
        staffServiceLinksAdded: number;
        staffServiceLinksRemoved: number;
        rosterRowsUpserted: number;
        rosterRowsRemoved: number;
      };
    }
  | { ok: false; error: string };

/* ───────────────────────────────────────────────────────────────
   Internal lightweight DB shapes
   ─────────────────────────────────────────────────────────────── */

type OpeningRowDB = {
  id: string;
  orgId: string;
  weekday: number;
  openMin: number;
  closeMin: number;
};

type ServiceDB = {
  id: string;
  orgId: string;
  name: string;
  durationMin: number;
  priceCents: number;
  colorHex: string | null;
};

type StaffDB = {
  id: string;
  orgId: string;
  name: string;
  email: string | null;
  active: boolean;
  colorHex: string | null;
};

type ScheduleDB = {
  id: string;
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type StaffSvcDB = {
  id: string;
  staffId: string;
  serviceId: string;
};

/* ───────────────────────────────────────────────────────────────
   Validation (Zod)
   ─────────────────────────────────────────────────────────────── */

const OpeningHoursRowZ = z.object({
  weekday: z.number().int().min(0).max(6),
  openMin: z.number().int().min(0).max(24 * 60),
  closeMin: z.number().int().min(0).max(24 * 60),
  closed: z.boolean().optional(),
});

const ServiceInZ = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  durationMin: z.number().int().positive().max(24 * 60),
  priceCents: z.number().int().min(0),
  colorHex: z.string().regex(/^#?[0-9A-Fa-f]{3,8}$/).nullable().optional(),
});

const StaffInZ = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
  active: z.boolean(),
  colorHex: z.string().regex(/^#?[0-9A-Fa-f]{3,8}$/).nullable().optional(),
  serviceIds: z.array(z.string().min(1)).default([]),
});

const RosterCellZ = z
  .object({
    start: z.string().optional().default(""),
    end: z.string().optional().default(""),
  })
  .refine(
    (v) =>
      // allow both blank = “no shift”, OR valid HH:MM with start <= end
      ((v.start ?? "") === "" && (v.end ?? "") === "") ||
      (/^\d{2}:\d{2}$/.test(v.start!) &&
        /^\d{2}:\d{2}$/.test(v.end!) &&
        hhmmLE(v.start!, v.end!)),
    "Roster times must be HH:MM or both empty"
  );

const RosterZ = z.record(z.array(RosterCellZ.optional()).length(7));
const NicheZ = z.enum(["HAIR_BEAUTY", "TRADES", "DENTAL", "LAW", "AUTO", "MEDICAL"]);

const SettingsPayloadZ = z.object({
  business: z.object({
    name: z.string().min(1),
    timezone: z.string().min(1),
    address: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    niche: NicheZ.optional(),
  }),
  openingHours: z.array(OpeningHoursRowZ).min(1).max(7),
  services: z.array(ServiceInZ).optional(),
  staff: z.array(StaffInZ).optional(),
  roster: RosterZ.optional(),
  bookingRules: z.unknown(),
  notifications: z.unknown(),
  onlineBooking: z.unknown(),
  calendarPrefs: z.unknown(),
  billing: z
    .object({
      managePlanUrl: z.string().optional(),
    })
    .optional(),
});

/* ───────────────────────────────────────────────────────────────
   Helpers
   ─────────────────────────────────────────────────────────────── */

   function hmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(n => Number(n) || 0);
  return h * 60 + m;
}

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

const clampDay = (d: number) => Math.min(6, Math.max(0, d));

function normalizeHex(hex?: string | null): string | null {
  if (!hex) return null;
  const h = hex.startsWith("#") ? hex : `#${hex}`;
  return h.toUpperCase();
}

function ensureSevenDays(rows: OpeningHoursRow[]): OpeningHoursRow[] {
  const byDay = new Map<number, OpeningHoursRow>();
  for (const r of rows) {
    const wd = clampDay(r.weekday);
    byDay.set(wd, {
      weekday: wd,
      openMin: r.closed ? 0 : r.openMin,
      closeMin: r.closed ? 0 : r.closeMin,
      closed: r.closed ?? (r.openMin === 0 && r.closeMin === 0),
    });
  }
  const out: OpeningHoursRow[] = [];
  for (let d = 0; d < 7; d++) {
    out.push(
      byDay.get(d) ?? { weekday: d, openMin: 0, closeMin: 0, closed: true }
    );
  }
  return out.sort((a, b) => a.weekday - b.weekday);
}

function hhmmLE(a: string, b: string) {
  const [ah, am] = a.split(":").map(Number);
  const [bh, bm] = b.split(":").map(Number);
  if (ah !== bh) return ah < bh;
  return am <= bm;
}

/* ───────────────────────────────────────────────────────────────
   LOAD
   ─────────────────────────────────────────────────────────────── */

export async function loadAllSettings(): Promise<{
  business: SettingsPayload["business"];
  orgSlug: string;
  plan: string;
  planLimits: { bookingsPerMonth: number | null; staffCount: number | null; automations: number | null };
  planFeatures: Record<string, boolean>;
  billing: { managePlanUrl?: string };
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

  const [orgRow, openingRows, services, staff, schedules, links, orgSettings] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: org.id },
      select: {
        name: true,
        timezone: true,
        address: true,
        dashboardConfig: true,
        niche: true,
        slug: true,
        plan: true,
      },
    }),
    prisma.openingHours.findMany({ where: { orgId: org.id }, orderBy: { weekday: "asc" } }),
    prisma.service.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" } }),
    prisma.staffMember.findMany({ where: { orgId: org.id }, orderBy: { name: "asc" } }),
    prisma.staffSchedule.findMany({
      where: { staff: { orgId: org.id } },
      orderBy: [{ staffId: "asc" }, { dayOfWeek: "asc" }],
    }),
    prisma.staffService.findMany({ where: { staff: { orgId: org.id } } }),
    prisma.orgSettings.findUnique({ where: { orgId: org.id }, select: { data: true } }),
  ]);

  const opening = ensureSevenDays(
    (openingRows as OpeningRowDB[]).map((h) => ({
      weekday: h.weekday,
      openMin: h.openMin,
      closeMin: h.closeMin,
      closed: h.openMin === 0 && h.closeMin === 0,
    }))
  );

  const roster: Roster = {};
  const perStaff = new Map<string, (RosterCell | undefined)[]>();
 for (const s of staff as StaffDB[])
  perStaff.set(s.id, Array.from({ length: 7 }, () => ({ start: "", end: "" })));
  for (const sc of schedules as ScheduleDB[]) {
    const arr = perStaff.get(sc.staffId);
    if (!arr) continue;
    const d = clampDay(sc.dayOfWeek);
    arr[d] = { start: sc.startTime, end: sc.endTime };
  }
  for (const s of staff as StaffDB[]) roster[s.id] = perStaff.get(s.id)!;

  const svcByStaff = new Map<string, string[]>();
  for (const s of staff as StaffDB[]) svcByStaff.set(s.id, []);
  for (const l of links as StaffSvcDB[]) svcByStaff.get(l.staffId)!.push(l.serviceId);

  const settingsData = (orgSettings?.data as Record<string, unknown>) || {};
  const planConfig = resolvePlanConfig(orgRow?.plan ?? null, settingsData);
  const billing = (settingsData.billing as Record<string, unknown>) || {};

  return {
    business: {
      name: orgRow?.name ?? "",
      timezone: orgRow?.timezone ?? "Pacific/Auckland",
      address: orgRow?.address ?? "",
      phone: (orgRow?.dashboardConfig as any)?.contact?.phone ?? "",
      email: (orgRow?.dashboardConfig as any)?.contact?.email ?? "",
      niche: orgRow?.niche ?? undefined,
    },
    orgSlug: orgRow?.slug ?? "",
    plan: planConfig.plan,
    planLimits: planConfig.limits,
    planFeatures: planConfig.features,
    billing: {
      managePlanUrl:
        typeof billing.managePlanUrl === "string" && billing.managePlanUrl.trim()
          ? billing.managePlanUrl.trim()
          : undefined,
    },
    openingHours: opening,
    services: (services as ServiceDB[]).map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
      colorHex: s.colorHex ?? "#DBEAFE",
    })),
    staff: (staff as StaffDB[]).map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email ?? undefined,
      active: s.active,
      colorHex: s.colorHex ?? "#10B981",
      serviceIds: svcByStaff.get(s.id) ?? [],
    })),
    roster,
    bookingRules: (orgRow?.dashboardConfig as any)?.bookingRules ?? {},
    notifications: (orgRow?.dashboardConfig as any)?.notifications ?? {},
    onlineBooking: (orgRow?.dashboardConfig as any)?.onlineBooking ?? {},
    calendarPrefs: (orgRow?.dashboardConfig as any)?.calendarPrefs ?? {},
  };
}

/* ───────────────────────────────────────────────────────────────
   SAVE (one transaction, strictly `tx.*` inside)
   ─────────────────────────────────────────────────────────────── */

export async function saveAllSettings(payload: SettingsPayload): Promise<SaveResponse> {
  try {
    const org = await requireOrg();

    const parsed = SettingsPayloadZ.safeParse(payload);
    if (!parsed.success) {
      const e = parsed.error.errors[0];
      return { ok: false, error: `Invalid payload at ${e.path.join(".")}: ${e.message}` };
    }
    const p = parsed.data;

    const opening = ensureSevenDays(
      p.openingHours.map((h) => ({
        weekday: clampDay(h.weekday),
        openMin: h.closed ? 0 : h.openMin,
        closeMin: h.closed ? 0 : h.closeMin,
        closed: h.closed ?? (h.openMin === 0 && h.closeMin === 0),
      }))
    );

    const servicesIn = (p.services ?? []).map((s) => ({
      ...s,
      colorHex: normalizeHex(s.colorHex),
    }));

    const staffIn = (p.staff ?? []).map((s) => ({
      ...s,
      colorHex: normalizeHex(s.colorHex),
      email: s.email ?? null,
      serviceIds: Array.isArray(s.serviceIds) ? s.serviceIds : [],
    }));

    const rosterIn: Roster | undefined = p.roster ?? undefined;

    const tempServiceIdToName = new Map<string, string>();
    for (const s of servicesIn) if (s.id) tempServiceIdToName.set(s.id, s.name);

    const tempStaffIdToName = new Map<string, string>();
    for (const s of staffIn) if (s.id) tempStaffIdToName.set(s.id, s.name);

    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        /* 0) Read current state up-front (single snapshot) */
        const [
          orgRow,
          openingRows,
          existingServices,
          existingStaff,
          existingSchedules,
          existingLinks,
          orgSettingsRow,
        ] = await Promise.all([
          tx.organization.findUnique({
            where: { id: org.id },
            select: { dashboardConfig: true },
          }),
          tx.openingHours.findMany({ where: { orgId: org.id } }),
          tx.service.findMany({ where: { orgId: org.id } }),
          tx.staffMember.findMany({ where: { orgId: org.id } }),
          tx.staffSchedule.findMany({ where: { staff: { orgId: org.id } } }),
          tx.staffService.findMany({ where: { staff: { orgId: org.id } } }),
          tx.orgSettings.findUnique({ where: { orgId: org.id }, select: { data: true } }),
        ]);

        /* 1) Organization basics + JSON config */
        const mergedConfig = {
          ...(orgRow?.dashboardConfig as any),
          bookingRules: p.bookingRules,
          notifications: p.notifications,
          onlineBooking: p.onlineBooking,
          calendarPrefs: p.calendarPrefs,
          contact: { phone: p.business.phone ?? "", email: p.business.email ?? "" },
        };

        await tx.organization.update({
          where: { id: org.id },
          data: {
            name: p.business.name,
            timezone: p.business.timezone,
            address: p.business.address ?? null,
            niche: p.business.niche ? (p.business.niche as any) : null,
            dashboardConfig: mergedConfig,
          },
        });

        if (p.billing) {
          const current = (orgSettingsRow?.data as Record<string, unknown>) || {};
          const next = {
            ...current,
            billing: {
              ...(current.billing as Record<string, unknown>),
              managePlanUrl:
                typeof p.billing.managePlanUrl === "string" && p.billing.managePlanUrl.trim()
                  ? p.billing.managePlanUrl.trim()
                  : undefined,
            },
          };
          await tx.orgSettings.upsert({
            where: { orgId: org.id },
            create: { orgId: org.id, data: next },
            update: { data: next },
          });
        }

        /* 2) Opening hours (upsert 7 rows) */
        const byDay = new Map<number, OpeningRowDB>(
          (openingRows as OpeningRowDB[]).map((r) => [r.weekday, r])
        );

        let openingUpserted = 0;

        for (const row of opening) {
          const ex = byDay.get(row.weekday);
          const openMin = row.openMin;
          const closeMin = row.closeMin;

          if (!ex) {
            await tx.openingHours.create({
              data: { orgId: org.id, weekday: row.weekday, openMin, closeMin },
            });
            openingUpserted++;
          } else if (ex.openMin !== openMin || ex.closeMin !== closeMin) {
            await tx.openingHours.update({
              where: { id: ex.id },
              data: { openMin, closeMin },
            });
            openingUpserted++;
          }
        }

        /* 3) Services (diff by id or name) */
        const svcById = new Map((existingServices as ServiceDB[]).map((s) => [s.id, s]));
        const svcByName = new Map((existingServices as ServiceDB[]).map((s) => [s.name, s]));

        let servicesUpserted = 0;
        let servicesRemoved = 0;
        const keepServiceIds = new Set<string>();

        for (const s of servicesIn) {
          let target: ServiceDB | undefined;
          if (s.id && svcById.has(s.id)) target = svcById.get(s.id);
          else if (svcByName.has(s.name)) target = svcByName.get(s.name);

          if (!target) {
            const created = (await tx.service.create({
              data: {
                orgId: org.id,
                name: s.name,
                durationMin: s.durationMin,
                priceCents: s.priceCents,
                colorHex: s.colorHex ?? null,
              },
            })) as ServiceDB;
            keepServiceIds.add(created.id);
            servicesUpserted++;
          } else {
            const needs =
              target.name !== s.name ||
              target.durationMin !== s.durationMin ||
              target.priceCents !== s.priceCents ||
              (target.colorHex ?? null) !== (s.colorHex ?? null);
            if (needs) {
              const updated = (await tx.service.update({
                where: { id: target.id },
                data: {
                  name: s.name,
                  durationMin: s.durationMin,
                  priceCents: s.priceCents,
                  colorHex: s.colorHex ?? null,
                },
              })) as ServiceDB;
              keepServiceIds.add(updated.id);
              servicesUpserted++;
            } else {
              keepServiceIds.add(target.id);
            }
          }
        }

        if (p.services) {
          const toRemove = (existingServices as ServiceDB[]).filter((s) => !keepServiceIds.has(s.id));
          if (toRemove.length) {
            await tx.staffService.deleteMany({
              where: { serviceId: { in: toRemove.map((x) => x.id) } },
            });
            const del = await tx.service.deleteMany({
              where: { id: { in: toRemove.map((x) => x.id) } },
            });
            servicesRemoved = del.count;
          }
        }

        // refresh for temp→real mapping
        const freshServices = (await tx.service.findMany({
          where: { orgId: org.id },
        })) as ServiceDB[];
        const nameToSvcId = new Map(freshServices.map((s) => [s.name, s.id]));
        const resolveServiceId = (maybeTemp: string): string | undefined => {
          const byName = tempServiceIdToName.get(maybeTemp);
          if (byName && nameToSvcId.has(byName)) return nameToSvcId.get(byName);
          // pass-through if already a real id
          return freshServices.find((s) => s.id === maybeTemp)?.id;
        };

        /* 4) Staff (diff by id or name) */
        const staffById = new Map((existingStaff as StaffDB[]).map((s) => [s.id, s]));
        const staffByName = new Map((existingStaff as StaffDB[]).map((s) => [s.name, s]));

        let staffUpserted = 0;
        let staffRemoved = 0;
        const keepStaffIds = new Set<string>();
        const tempToRealStaffId = new Map<string, string>();

        for (const st of staffIn) {
          let target: StaffDB | undefined;
          if (st.id && staffById.has(st.id)) target = staffById.get(st.id);
          else if (staffByName.has(st.name)) target = staffByName.get(st.name);

          if (!target) {
            const created = (await tx.staffMember.create({
              data: {
                orgId: org.id,
                name: st.name,
                email: st.email ?? null,
                active: st.active,
                colorHex: st.colorHex ?? null,
              },
            })) as StaffDB;
            keepStaffIds.add(created.id);
            staffUpserted++;
            if (st.id) tempToRealStaffId.set(st.id, created.id);
          } else {
            const needs =
              target.name !== st.name ||
              target.email !== (st.email ?? null) ||
              target.active !== st.active ||
              (target.colorHex ?? null) !== (st.colorHex ?? null);

            if (needs) {
              const updated = (await tx.staffMember.update({
                where: { id: target.id },
                data: {
                  name: st.name,
                  email: st.email ?? null,
                  active: st.active,
                  colorHex: st.colorHex ?? null,
                },
              })) as StaffDB;
              keepStaffIds.add(updated.id);
              staffUpserted++;
              if (st.id) tempToRealStaffId.set(st.id, updated.id);
            } else {
              keepStaffIds.add(target.id);
              if (st.id) tempToRealStaffId.set(st.id, target.id);
            }
          }
        }

        if (p.staff) {
          const toRemove = (existingStaff as StaffDB[]).filter((s) => !keepStaffIds.has(s.id));
          if (toRemove.length) {
            await tx.staffSchedule.deleteMany({
              where: { staffId: { in: toRemove.map((x) => x.id) } },
            });
            await tx.staffService.deleteMany({
              where: { staffId: { in: toRemove.map((x) => x.id) } },
            });
            const del = await tx.staffMember.deleteMany({
              where: { id: { in: toRemove.map((x) => x.id) } },
            });
            staffRemoved = del.count;
          }
        }

        if (!p.staff) {
          for (const [tempId, nm] of tempStaffIdToName) {
            const existing = (existingStaff as StaffDB[]).find((s) => s.name === nm);
            if (existing) tempToRealStaffId.set(tempId, existing.id);
          }
        }

        /* 5) StaffService links (precise diff) */
        const currentByStaff = new Map<string, Set<string>>();
        for (const l of existingLinks as StaffSvcDB[]) {
          if (!currentByStaff.has(l.staffId)) currentByStaff.set(l.staffId, new Set());
          currentByStaff.get(l.staffId)!.add(l.serviceId);
        }

        const desiredByStaff = new Map<string, Set<string>>();
        for (const st of staffIn) {
          const resolvedStaffId =
            (st.id && tempToRealStaffId.get(st.id)) ||
            (st.id && (existingStaff as StaffDB[]).find((x) => x.id === st.id)?.id) ||
            (existingStaff as StaffDB[]).find((x) => x.name === st.name)?.id;

          if (!resolvedStaffId) continue;

          const svcSet = new Set<string>();
          for (const raw of st.serviceIds ?? []) {
            const real = resolveServiceId(raw);
            if (real) svcSet.add(real);
          }
          desiredByStaff.set(resolvedStaffId, svcSet);
        }

        const toAdd: { staffId: string; serviceId: string }[] = [];
        const toRemove: { staffId: string; serviceId: string }[] = [];

        const staffKeys = new Set([
          ...Array.from(currentByStaff.keys()),
          ...Array.from(desiredByStaff.keys()),
        ]);

        for (const staffId of staffKeys) {
          const cur = currentByStaff.get(staffId) ?? new Set<string>();
          const des = desiredByStaff.get(staffId) ?? new Set<string>();
          for (const svcId of des) if (!cur.has(svcId)) toAdd.push({ staffId, serviceId: svcId });
          for (const svcId of cur) if (!des.has(svcId)) toRemove.push({ staffId, serviceId: svcId });
        }

        let linksAdded = 0;
        let linksRemoved = 0;

        if (toAdd.length) {
          await tx.staffService.createMany({ data: toAdd, skipDuplicates: true });
          linksAdded = toAdd.length;
        }
        if (toRemove.length) {
          const BATCH = 500;
          for (let i = 0; i < toRemove.length; i += BATCH) {
            const batch = toRemove.slice(i, i + BATCH);
            await tx.staffService.deleteMany({
              where: { OR: batch.map(({ staffId, serviceId }) => ({ staffId, serviceId })) },
            });
          }
          linksRemoved = toRemove.length;
        }

        /* 6) Roster (per staff/day) */
        let rosterUpserted = 0;
        let rosterRemoved = 0;

        if (rosterIn && Object.keys(rosterIn).length) {
          // map staff key -> real id
          const rosterEntries: Array<{ staffId: string; week: { start: string; end: string }[] }> = [];

          for (const [key, week] of Object.entries(rosterIn)) {
            const realId =
              tempToRealStaffId.get(key) ||
              (existingStaff as StaffDB[]).find((x) => x.id === key)?.id ||
              (() => {
                const byName = tempStaffIdToName.get(key);
                return byName
                  ? (existingStaff as StaffDB[]).find((x) => x.name === byName)?.id
                  : undefined;
              })();

            if (!realId) continue;

           const week7 = Array.from({ length: 7 }, (_, d) => {
  const cell = week?.[d] ?? { start: "", end: "" };
  // Empty strings mean “no shift” for that day
  if (!cell.start || !cell.end) return { start: "", end: "" };
  if (!/^\d{2}:\d{2}$/.test(cell.start) || !/^\d{2}:\d{2}$/.test(cell.end)) return { start: "", end: "" };
  if (!hhmmLE(cell.start, cell.end)) return { start: "", end: "" };
  return { start: cell.start, end: cell.end };
});

            rosterEntries.push({ staffId: realId, week: week7 });
          }

          // index existing schedules by key
          const schedByKey = new Map<string, ScheduleDB>();
          for (const r of existingSchedules as ScheduleDB[]) {
            schedByKey.set(`${r.staffId}:${r.dayOfWeek}`, r);
          }

          for (const { staffId, week } of rosterEntries) {
            for (let d = 0; d < 7; d++) {
       const cell = week[d] ?? { start: "", end: "" };   // <- never undefined now
const key = `${staffId}:${d}`;
const ex = schedByKey.get(key);
const isEmpty = !cell.start || !cell.end;         // blanks mean “no shift”

if (isEmpty) {
  if (ex) {
    await tx.staffSchedule.delete({ where: { id: ex.id } });
    rosterRemoved++;
  }
  continue;
}

if (!ex) {
  await tx.staffSchedule.create({
    data: { staffId, dayOfWeek: d, startTime: cell.start, endTime: cell.end },
  });
  rosterUpserted++;
} else if (ex.startTime !== cell.start || ex.endTime !== cell.end) {
  await tx.staffSchedule.update({
    where: { id: ex.id },
    data: { startTime: cell.start, endTime: cell.end },
  });
  rosterUpserted++;
}
            }
          }
        }

        return {
          organizationUpdated: true,
          openingHoursUpserted: openingUpserted,
          servicesUpserted,
          servicesRemoved,
          staffUpserted,
          staffRemoved,
          staffServiceLinksAdded: linksAdded,
          staffServiceLinksRemoved: linksRemoved,
          rosterRowsUpserted: rosterUpserted,
          rosterRowsRemoved: rosterRemoved,
        };
      },
      { timeout: 20000 } // give the interactive tx a sensible window
    );

    return { ok: true, result };
  } catch (err: any) {
    console.error("saveAllSettings failed:", err);
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}
