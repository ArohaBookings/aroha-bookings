// app/calendar/google/page.tsx
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCalendarClient } from "@/lib/integrations/google/calendar";
import GoogleCalendarSelectClient from "./SelectClient";

type CalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole?: string;
};

export default async function GoogleCalendarSelectPage() {
  // 1) Require auth
  const session = await getServerSession(authOptions);
  const userEmail = session?.user?.email ?? null;

  if (!userEmail) {
    redirect("/api/auth/signin");
  }

  // 2) Make sure user belongs to an org
  const membership = await prisma.membership.findFirst({
    where: { user: { email: userEmail } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) {
    redirect("/onboarding");
  }

  let calendars: CalendarListItem[] = [];
  let error: string | null = null;

  try {
    const gcal = await getCalendarClient(membership.orgId);

    // If your getGCal() is typed as Calendar | null, this protects against it
    if (!gcal) {
      error =
        "Google is not connected for this organization. Please connect Google, then try again.";
    } else {
      const res = await gcal.calendarList.list({
        minAccessRole: "writer",
        showHidden: false,
        maxResults: 50,
      });

      const items = res.data.items ?? [];

      calendars = items
        .filter((c): c is NonNullable<typeof c> & { id: string; summary: string } => {
          return Boolean(c && c.id && c.summary);
        })
        .map((c) => ({
          id: String(c.id),
          summary: String(c.summary),
          primary: Boolean(c.primary),
          accessRole: c.accessRole ?? undefined,
        }));

      // Sort: primary first, then by name
      calendars.sort((a, b) => {
        if (a.primary && !b.primary) return -1;
        if (!a.primary && b.primary) return 1;
        return a.summary.localeCompare(b.summary);
      });

      if (!calendars.length) {
        error =
          "No writable Google calendars were found on this account. Check Google Calendar and make sure you have at least one calendar you can edit.";
      }
    }
  } catch (err) {
    console.error("Error listing Google calendars:", err);
    error =
      "Could not connect to Google Calendar. Try disconnecting and reconnecting Google, then open this page again.";
  }

  return (
    <div className="p-6 md:p-8 bg-zinc-50 min-h-screen text-zinc-900">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">
          Connect Google Calendar
        </h1>
        <p className="text-sm text-zinc-600 mb-6">
          Choose which Google Calendar Aroha Bookings should sync with. New
          bookings and Google events on that calendar will stay in sync.
        </p>

        <GoogleCalendarSelectClient calendars={calendars} error={error} />
      </div>
    </div>
  );
}
