// app/api/calendar/google/list/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCalendarClient } from "@/lib/integrations/google/calendar";
import type { calendar_v3 } from "googleapis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type CalendarListItem = {
  id: string;
  summary: string;
  primary: boolean;
  accessRole?: string | null;
};

export async function GET() {
  try {
    // 1) Auth guard
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email ?? null;

    if (!userEmail) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      );
    }

    const membership = await prisma.membership.findFirst({
      where: { user: { email: userEmail } },
      select: { orgId: true },
      orderBy: { orgId: "asc" },
    });
    if (!membership?.orgId) {
      return NextResponse.json({ ok: false, error: "No organization" }, { status: 400 });
    }

    // 2) Build Google Calendar client from org connection
    const cal = await getCalendarClient(membership.orgId);
    if (!cal) {
      return NextResponse.json(
        { ok: false, error: "Google Calendar client not available" },
        { status: 401 },
      );
    }

    // 3) List calendars with at least writer access
    const resp = await cal.calendarList.list({
      minAccessRole: "writer",
      showHidden: false,
      maxResults: 50,
    });

    const rawItems: calendar_v3.Schema$CalendarListEntry[] = resp.data.items ?? [];

    const items: CalendarListItem[] = rawItems
      .filter((c): c is calendar_v3.Schema$CalendarListEntry => Boolean(c && c.id))
      .map((c) => ({
        id: c.id as string,
        summary: c.summary || "(no name)",
        primary: Boolean((c as any).primary),
        accessRole: c.accessRole ?? null,
      }));

    // Sort: primary first, then by summary
    items.sort((a, b) => {
      if (a.primary && !b.primary) return -1;
      if (!a.primary && b.primary) return 1;
      return a.summary.localeCompare(b.summary);
    });

    if (!items.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No writable Google calendars found on this account. Make sure you have at least one calendar you can edit.",
          items: [],
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err: unknown) {
    console.error("calendar/google/list error:", err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Failed to list calendars";

    // If the underlying lib threw because tokens are missing/invalid,
    // surface that as a 401-style error so the client can prompt re-connect.
    if (
      message.includes("No Google access token") ||
      message.toLowerCase().includes("invalid credentials")
    ) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
