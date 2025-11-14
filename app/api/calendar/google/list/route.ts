// app/api/calendar/google/list/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGCal } from "@/lib/google-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const cal = await getGCal();
    const resp = await cal.calendarList.list();
    const items =
      (resp.data.items || []).map((c) => ({
        id: c.id!,
        summary: c.summary || "(no name)",
        primary: Boolean((c as any).primary),
        accessRole: c.accessRole,
      })) ?? [];

    return NextResponse.json({ ok: true, items });
  } catch (err: any) {
    console.error("calendar/google/list error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Failed to list calendars" },
      { status: 500 }
    );
  }
}
