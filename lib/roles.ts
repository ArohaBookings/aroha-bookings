import { prisma } from "@/lib/db";

function readEmailAllowlist(envKey: string): string[] {
  return (process.env[envKey] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase();
  const allowlist = [
    ...readEmailAllowlist("SUPERADMIN_EMAILS"),
    ...readEmailAllowlist("SUPERADMINS"),
  ];
  return allowlist.includes(normalized);
}

export async function canAccessSuperAdminByEmail(email?: string | null): Promise<boolean> {
  if (!email) return false;
  if (isSuperAdminEmail(email)) return true;
  const membership = await prisma.membership.findFirst({
    where: {
      user: { email },
      role: { in: ["owner", "admin"] },
    },
    select: { id: true },
  });
  return Boolean(membership);
}
