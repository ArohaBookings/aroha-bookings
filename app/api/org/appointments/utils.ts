import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function getMembershipContext() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) {
    return { ok: false, status: 401, error: "Not signed in" } as const;
  }

  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });
  if (!membership?.org) {
    return { ok: false, status: 403, error: "No organization" } as const;
  }

  return {
    ok: true,
    email,
    orgId: membership.org.id,
    role: membership.role,
  } as const;
}

export async function requireStaffContext() {
  const base = await getMembershipContext();
  if (!base.ok) return base;

  const staff = await prisma.staffMember.findFirst({
    where: { orgId: base.orgId, email: base.email },
    select: { id: true },
  });

  if (!staff) {
    return { ok: false, status: 403, error: "Staff record not linked" } as const;
  }

  const { ok: _ignored, ...rest } = base;

  return {
    ok: true,
    ...rest,
    staffId: staff.id,
  } as const;
}


export async function requireAdminContext() {
  const base = await getMembershipContext();
  if (!base.ok) return base;

  if (!["owner", "admin"].includes(base.role)) {
    return { ok: false, status: 403, error: "Not authorized" } as const;
  }

  return base;
}
