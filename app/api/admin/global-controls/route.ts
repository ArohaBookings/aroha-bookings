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

function normalizeControls(input: unknown) {
  const record = (input as Record<string, unknown>) || {};
  return {
    disableAutoSendAll: Boolean(record.disableAutoSendAll),
    disableMessagesHubAll: Boolean(record.disableMessagesHubAll),
    disableEmailAIAll: Boolean(record.disableEmailAIAll),
    disableAiSummariesAll: Boolean(record.disableAiSummariesAll),
  };
}

async function getHQOrgId() {
  const slug = (process.env.SUPERADMIN_ORG_SLUG || "aroha-hq").trim();
  if (!slug) return null;
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  return org?.id || null;
}

export async function GET() {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const orgId = await getHQOrgId();
  if (!orgId) return json({ ok: false, error: "Superadmin org not found" }, 404);

  const os = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
  const data = (os?.data as Record<string, unknown>) || {};
  const controls = normalizeControls(data.globalControls);

  return json({ ok: true, controls });
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const orgId = await getHQOrgId();
  if (!orgId) return json({ ok: false, error: "Superadmin org not found" }, 404);

  const payload = await req.json().catch(() => ({}));
  const controls = normalizeControls(payload);

  const existing = await prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } });
  const data = (existing?.data as Record<string, unknown>) || {};
  const next = { ...data, globalControls: controls };

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: next as any },
    update: { data: next as any },
  });

  return json({ ok: true, controls });
}
