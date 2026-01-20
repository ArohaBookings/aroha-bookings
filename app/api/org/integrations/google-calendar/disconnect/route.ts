import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { disconnectGoogleCalendar } from "@/lib/integrations/google/disconnect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

async function resolveOrgId(email: string, inputOrgId?: string) {
  if (inputOrgId) return inputOrgId;
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });
  return membership?.orgId ?? null;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { orgId?: string; accountEmail?: string };
  const orgId = await resolveOrgId(email, (body.orgId || "").trim() || undefined);
  const accountEmail = (body.accountEmail || "").trim();

  if (!orgId) {
    return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });
  }

  const isSuper = isSuperadmin(email);
  if (!isSuper) {
    const membership = await prisma.membership.findFirst({
      where: { orgId, user: { email } },
      select: { id: true },
    });
    if (!membership) {
      return NextResponse.json({ ok: false, error: "Not authorized for org" }, { status: 403 });
    }
  }

  await disconnectGoogleCalendar({ orgId, accountEmail: accountEmail || null });
  return NextResponse.json({ ok: true });
}
