// lib/db.ts
import { PrismaClient, Prisma } from "@prisma/client";

/**
 * Prisma cannot run in the Edge runtime.
 * If you move a route to `runtime: "edge"`, make sure it does NOT import this file.
 */
const isEdge =
  typeof process !== "undefined" &&
  (process as any).env?.NEXT_RUNTIME === "edge";

if (isEdge) {
  throw new Error(
    "Prisma is not supported in the Edge runtime. Move this route to the Node.js runtime."
  );
}

/**
 * Singleton in dev (to survive hot reloads), plain instance in prod.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/* ───────────────────────────────────────────────────────────────
   Transactions & retries
   ─────────────────────────────────────────────────────────────── */

/**
 * Run an interactive transaction with a consistent timeout (ms).
 * Keeps type safety on the callback param.
 */
export async function withTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { timeout?: number } = {}
): Promise<T> {
  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      return fn(tx);
    },
    {
      timeout: opts.timeout ?? 20_000,
    }
  );
}

/**
 * Simple retry for transient DB errors (timeouts, blips, deadlocks).
 */
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseMs = 150 }: { attempts?: number; baseMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const code = err?.code as string | undefined;
      const msg = String(err?.message || "");
      const transient =
        code === "P1001" || // connection error
        code === "P1002" || // connection timeout
        code === "P2028" || // transaction API error (retriable)
        msg.includes("ETIMEDOUT") ||
        msg.includes("ECONNRESET") ||
        msg.toLowerCase().includes("deadlock");

      if (!transient || i === attempts - 1) throw err;
      const delay = baseMs * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  // Should never get here, but TS wants a throw.
  throw lastErr as Error;
}

/* ───────────────────────────────────────────────────────────────
   Convenience lookups used by settings/calendar
   ─────────────────────────────────────────────────────────────── */

export async function getUserAndOrgByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
    include: { memberships: { include: { org: true } } },
  });
}

export async function requireOrgForEmail(email: string) {
  const row = await getUserAndOrgByEmail(email);
  const org = row?.memberships?.[0]?.org;
  if (!org) throw new Error("No organization found for user");
  return org;
}

/* ───────────────────────────────────────────────────────────────
   Dashboard config JSON helpers
   (We avoid Prisma’s JSON utility types for widest compatibility)
   ─────────────────────────────────────────────────────────────── */

// Minimal JSON type that works across Prisma versions
type JSONPrimitive = string | number | boolean | null;
export type JSONValue = JSONPrimitive | { [k: string]: JSONValue } | JSONValue[];

// Keep this flexible so you can extend without schema changes
export type DashboardConfig = {
  contact?: { phone?: string; email?: string };
  bookingRules?: JSONValue;
  notifications?: JSONValue;
  onlineBooking?: JSONValue;
  calendarPrefs?: JSONValue;
  // Add more keys over time…
  [k: string]: JSONValue | undefined;
};

export async function readOrgDashboardConfig(orgId: string): Promise<DashboardConfig> {
  const row = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { dashboardConfig: true },
  });
  return (row?.dashboardConfig as unknown as DashboardConfig) ?? {};
}

/**
 * Merge a partial patch into dashboardConfig.
 * We cast to `any` for the `update` write to stay compatible with older Prisma versions
 * that don’t export InputJsonValue. This keeps `tsc --noEmit` happy.
 */
export async function writeOrgDashboardConfig(
  orgId: string,
  patch: Partial<DashboardConfig>
): Promise<DashboardConfig> {
  const current = await readOrgDashboardConfig(orgId);
  const next: DashboardConfig = { ...current, ...patch };

  await prisma.organization.update({
    where: { id: orgId },
    data: { dashboardConfig: next as any },
  });

  return next;
}

/* Focused helpers used by settings & calendar UIs */

export async function readOrgContact(orgId: string) {
  const cfg = await readOrgDashboardConfig(orgId);
  return cfg.contact ?? {};
}

export async function writeOrgContact(
  orgId: string,
  contact: { phone?: string; email?: string }
) {
  return writeOrgDashboardConfig(orgId, { contact });
}

export async function readCalendarPrefs(orgId: string) {
  const cfg = await readOrgDashboardConfig(orgId);
  return cfg.calendarPrefs ?? {};
}

export async function writeCalendarPrefs(orgId: string, prefs: JSONValue) {
  return writeOrgDashboardConfig(orgId, { calendarPrefs: prefs });
}

/* ───────────────────────────────────────────────────────────────
   Test/CLI utility
   ─────────────────────────────────────────────────────────────── */
export async function disconnectPrisma() {
  await prisma.$disconnect();
}