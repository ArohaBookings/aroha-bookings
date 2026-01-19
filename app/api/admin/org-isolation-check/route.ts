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

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return json({ ok: false, error: "Not available in production" }, 404);
  }

  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return json({ ok: false, error: "Not authenticated" }, 401);
  const allowed = await canAccessSuperAdminByEmail(email);
  if (!allowed) return json({ ok: false, error: "Not authorized" }, 403);

  const [orgs, staff, customers, appts] = await Promise.all([
    prisma.organization.findMany({ select: { id: true, name: true } }),
    prisma.staffMember.groupBy({ by: ["orgId"], _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["orgId"], _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["orgId"], _count: { _all: true } }),
  ]);

  const summary = orgs.map((org) => ({
    orgId: org.id,
    name: org.name,
    staffCount: staff.find((s) => s.orgId === org.id)?._count._all || 0,
    customerCount: customers.find((s) => s.orgId === org.id)?._count._all || 0,
    appointmentCount: appts.find((s) => s.orgId === org.id)?._count._all || 0,
  }));

  return json({ ok: true, summary });
}
