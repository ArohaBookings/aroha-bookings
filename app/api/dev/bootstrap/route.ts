import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  // 1) Upsert a default org for you
  const org = await prisma.organization.upsert({
    where: { slug: "default" },
    update: { name: "My Business", timezone: "Pacific/Auckland" },
    create: {
      name: "My Business",
      slug: "default",
      timezone: "Pacific/Auckland",
      plan: "PROFESSIONAL",
    },
  });

  // 2) Ensure a membership for your user
  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  await prisma.membership.upsert({
    where: {
      userId_orgId: {
        userId: user.id,
        orgId: org.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      orgId: org.id,
      role: "owner",
    },
  });

  return NextResponse.json({ ok: true, org });
}
