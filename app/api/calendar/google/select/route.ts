// app/api/calendar/google/select/route.ts
// Store / read the selected Google Calendar ID for the current org.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readGoogleCalendarIntegration, writeGoogleCalendarIntegration } from "@/lib/orgSettings";

export const runtime = "nodejs";

/* ──────────────────────────────────────────────────────────────
   Small helpers
   ────────────────────────────────────────────────────────────── */

async function requireSessionEmail() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email) throw new Error("AUTH_MISSING");
  return { email, session };
}

async function resolveOrgIdForUser(email: string): Promise<string> {
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    select: { orgId: true },
    orderBy: { orgId: "asc" },
  });

  if (!membership?.orgId) throw new Error("ORG_MISSING");
  return membership.orgId;
}

/* ──────────────────────────────────────────────────────────────
   GET  → read current Google calendar selection for this org
   (used by UI to show status)
   ────────────────────────────────────────────────────────────── */

export async function GET() {
  try {
    const { email } = await requireSessionEmail();
    const orgId = await resolveOrgIdForUser(email);

    // Read OrgSettings JSON
    const os = await prisma.orgSettings.findUnique({
      where: { orgId },
      select: { data: true },
    });

    const data = (os?.data as Record<string, unknown>) ?? {};
    const google = readGoogleCalendarIntegration(data);
    const googleCalendarId = google.calendarId;
    const googleAccountEmail = google.accountEmail;

    // Check if we have a connection row for this org/provider/email
    const connection = await prisma.calendarConnection.findFirst({
      where: { orgId, provider: "google" },
      select: {
        id: true,
        orgId: true,
        provider: true,
        accountEmail: true,
        expiresAt: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    const isConnected = Boolean(google.connected && googleCalendarId && connection);

    return NextResponse.json(
      {
        ok: true,
        connected: isConnected,
        calendarId: googleCalendarId,
        accountEmail: googleAccountEmail ?? connection?.accountEmail ?? email,
        provider: connection?.provider ?? "google",
        connectionId: connection?.id ?? null,
      },
      { status: 200 },
    );
  } catch (err: any) {
    if (err instanceof Error && err.message === "AUTH_MISSING") {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      );
    }
    if (err instanceof Error && err.message === "ORG_MISSING") {
      return NextResponse.json(
        { ok: false, error: "No organization" },
        { status: 400 },
      );
    }

    console.error("Error in GET /api/calendar/google/select:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ──────────────────────────────────────────────────────────────
   POST → set / update / clear selected Google calendar for org
   Body:
     { calendarId: string | null }
   - if calendarId is falsy → we treat it as disconnect
   ────────────────────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    // 1) Auth + org
    const { email } = await requireSessionEmail();
    const orgId = await resolveOrgIdForUser(email);

    // 2) Parse & validate body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const rawCalendarId = (body as any)?.calendarId;
    const calendarId =
      typeof rawCalendarId === "string" ? rawCalendarId.trim() : "";

    const isDisconnect = !calendarId;

    // 3) Require an existing org-scoped connection
    let connectionId: string | null = null;
    if (!isDisconnect) {
      const existing = await prisma.calendarConnection.findFirst({
        where: { orgId, provider: "google" },
        select: { id: true, accountEmail: true },
        orderBy: { updatedAt: "desc" },
      });
      if (!existing) {
        return NextResponse.json(
          { ok: false, error: "Google connection not found. Connect Google first." },
          { status: 400 },
        );
      }
      connectionId = existing.id;
    }

// 4) Upsert OrgSettings JSON with data.integrations.googleCalendar
const existing = await prisma.orgSettings.upsert({
  where: { orgId },
  create: { orgId, data: {} },
  update: {},
});

    const data = { ...(existing.data as Record<string, unknown>) };

// ✅ define `connection` so TS stops complaining
const connection = connectionId
  ? await prisma.calendarConnection.findUnique({
      where: { id: connectionId },
      select: { accountEmail: true },
    })
  : null;

    let next = data;
    if (isDisconnect) {
      next = writeGoogleCalendarIntegration(data, {
        connected: false,
        calendarId: null,
        accountEmail: null,
        syncEnabled: false,
      });
    } else {
      next = writeGoogleCalendarIntegration(data, {
        connected: true,
        calendarId,
        accountEmail: connection?.accountEmail ?? email,
        syncEnabled: true,
      });
    }

    await prisma.orgSettings.update({
      where: { orgId },
      data: { data: next as any },
    });

    return NextResponse.json(
      {
        ok: true,
        mode: isDisconnect ? "disconnected" : "connected",
        calendarId: isDisconnect ? null : calendarId,
        connectionId,
        accountEmail: isDisconnect ? null : connection?.accountEmail ?? email,
      },
      { status: 200 },
    );

  } catch (err: any) {
    if (err instanceof Error && err.message === "AUTH_MISSING") {
      return NextResponse.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      );
    }
    if (err instanceof Error && err.message === "ORG_MISSING") {
      return NextResponse.json(
        { ok: false, error: "No organization" },
        { status: 400 },
      );
    }

    console.error("Error in POST /api/calendar/google/select:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}

/* ──────────────────────────────────────────────────────────────
   OPTIONS → CORS preflight (safe default)
   ────────────────────────────────────────────────────────────── */

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200 });
}
