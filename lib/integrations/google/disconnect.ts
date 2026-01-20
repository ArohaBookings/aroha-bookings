import { prisma } from "@/lib/db";
import { writeGoogleCalendarIntegration } from "@/lib/orgSettings";

type DisconnectGoogleInput = {
  orgId: string;
  accountEmail?: string | null;
};

export async function disconnectGoogleCalendar({ orgId, accountEmail }: DisconnectGoogleInput) {
  await prisma.calendarConnection.deleteMany({
    where: {
      orgId,
      provider: "google",
      ...(accountEmail ? { accountEmail } : {}),
    },
  });

  const os = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { data: true },
  });

  if (!os) return;

  const data = { ...(os.data as Record<string, unknown>) };
  delete (data as any).calendarSyncErrors;

  const next = writeGoogleCalendarIntegration(data, {
    connected: false,
    calendarId: null,
    accountEmail: null,
    syncEnabled: false,
    lastSyncAt: null,
    lastSyncError: null,
  });

  await prisma.orgSettings.update({
    where: { orgId },
    data: { data: next as any },
  });
}
