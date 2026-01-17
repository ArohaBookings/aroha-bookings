import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveBranding } from "@/lib/branding";
import { getOrgEntitlements } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    select: { org: { select: { id: true, name: true, slug: true, dashboardConfig: true, address: true } }, orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.org) {
    return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
  }

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: membership.orgId },
    select: { data: true },
  });

  const settingsData = (orgSettings?.data as Record<string, unknown>) || {};
  const branding = resolveBranding(settingsData);
  const dashboardConfig = (membership.org.dashboardConfig as Record<string, unknown>) || {};
  const contact = (dashboardConfig.contact as Record<string, unknown>) || {};

  const entitlements = await getOrgEntitlements(membership.orgId);

  return NextResponse.json({
    ok: true,
    org: {
      id: membership.org.id,
      name: membership.org.name,
      slug: membership.org.slug,
      address: membership.org.address ?? "",
      phone: typeof contact.phone === "string" ? contact.phone : "",
      email: typeof contact.email === "string" ? contact.email : "",
    },
    branding,
    demoMode: Boolean(settingsData.demoMode),
    entitlements,
  });
}
