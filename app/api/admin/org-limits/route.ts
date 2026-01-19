import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  const allowed = await canAccessSuperAdminByEmail(email);
  if (!allowed) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

function normalizeLimits(input: unknown) {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;
  const toNum = (value: unknown) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    if (num <= 0) return null;
    return Math.floor(num);
  };
  return {
    bookingsPerMonth: toNum(record.bookingsPerMonth),
    staffCount: toNum(record.staffCount),
    automations: toNum(record.automations),
  };
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const orgId = typeof (body as any)?.orgId === "string" ? (body as any).orgId.trim() : "";
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const planLimits = normalizeLimits((body as any)?.planLimits);

  const existing = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (existing?.data as Record<string, unknown>) || {};

  const next = {
    ...data,
    planLimits,
  };

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: next as any },
    update: { data: next as any },
  });

  return json({ ok: true, planLimits });
}
