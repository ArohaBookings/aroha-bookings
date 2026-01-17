import { prisma } from "@/lib/db";

export type EmailIdentity = {
  fromName: string;
  replyTo?: string;
  supportEmail?: string;
  footerText?: string;
};

function isValidEmail(email?: string | null) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function resolveEmailIdentity(orgId: string, orgName: string): Promise<EmailIdentity> {
  const [org, settings, owner] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true, dashboardConfig: true },
    }),
    prisma.orgSettings.findUnique({ where: { orgId }, select: { data: true } }),
    prisma.membership.findFirst({
      where: { orgId, role: "owner" },
      select: { user: { select: { email: true } } },
    }),
  ]);

  const data = (settings?.data as Record<string, unknown>) || {};
  const identity = (data.emailIdentity as Record<string, unknown>) || {};
  const dashboardConfig = (org?.dashboardConfig as Record<string, unknown>) || {};
  const contact = (dashboardConfig.contact as Record<string, unknown>) || {};
  const orgEmail = typeof contact.email === "string" ? contact.email : undefined;

  const fromName =
    typeof identity.fromName === "string" && identity.fromName.trim()
      ? identity.fromName.trim()
      : `${orgName || org?.name || "Aroha Bookings"} via Aroha`;

  const replyTo =
    (typeof identity.replyTo === "string" && isValidEmail(identity.replyTo) && identity.replyTo.trim()) ||
    (orgEmail && isValidEmail(orgEmail) ? orgEmail : undefined) ||
    (owner?.user?.email && isValidEmail(owner.user.email) ? owner.user.email : undefined);

  const supportEmail =
    (typeof identity.supportEmail === "string" && isValidEmail(identity.supportEmail) && identity.supportEmail.trim()) ||
    replyTo;

  const footerText =
    typeof identity.footerText === "string" && identity.footerText.trim()
      ? identity.footerText.trim()
      : "You’re receiving this message because you booked with us.";

  return { fromName, replyTo, supportEmail, footerText };
}
