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

const PLAN_KEYS = ["LITE", "STARTER", "PROFESSIONAL", "PREMIUM"] as const;

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as { orgId?: string; plan?: string; planNotes?: string };
  const orgId = (body.orgId || "").trim();
  const plan = (body.plan || "").toUpperCase();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);
  if (!PLAN_KEYS.includes(plan as any)) {
    return json({ ok: false, error: "Invalid plan" }, 400);
  }

  await prisma.organization.update({
    where: { id: orgId },
    data: { plan: plan as any },
  });

  const os = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
  const data = (os?.data as Record<string, unknown>) || {};
  const next = {
    ...data,
    planNotes: typeof body.planNotes === "string" ? body.planNotes.trim() : undefined,
  };

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: next as any },
    update: { data: next as any },
  });

  return json({ ok: true, plan, planNotes: next.planNotes ?? "" });
}
