import { prisma } from "@/lib/db";
import { writeGmailIntegration } from "@/lib/orgSettings";

export async function disconnectGmail(orgId: string) {
  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });
  const data = (os?.data as Record<string, unknown>) || {};
  const next = writeGmailIntegration(data, {
    connected: false,
    accountEmail: null,
    lastError: null,
  });

  await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, data: next as any },
    update: { data: next as any },
  });
}
