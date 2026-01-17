import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function requireStaffPageContext() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) redirect("/login");

  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    include: { org: true },
  });
  if (!membership?.org) redirect("/unauthorized");

  if (!["owner", "admin", "staff"].includes(membership.role)) {
    redirect("/unauthorized");
  }

  const staff = await prisma.staffMember.findFirst({
    where: { orgId: membership.org.id, email },
    select: { id: true, name: true, email: true },
  });

  return {
    org: { id: membership.org.id, name: membership.org.name, timezone: membership.org.timezone },
    staff,
    email,
  };
}
