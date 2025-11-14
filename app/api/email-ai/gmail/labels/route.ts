// app/api/email-ai/gmail/labels/route.ts
// ───────────────────────────────────────────────
//  📧 Gmail Labels Endpoint
//  Lists all Gmail labels for the connected account.
//  Used by Aroha Bookings / Email AI for sync, tagging,
//  or verifying label setup (e.g. "Aroha-AI" custom label).
// ───────────────────────────────────────────────

import { NextResponse } from "next/server";
import { getGmail } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const gmail = await getGmail();

    // No Gmail connection configured for this user/org
    if (!gmail) {
      return NextResponse.json(
        {
          ok: false,
          error: "No Gmail connection. Please reconnect Google.",
          type: "auth",
        },
        { status: 401 }
      );
    }

    const res = await gmail.users.labels.list({ userId: "me" });

    const allLabels = res.data.labels ?? [];

    // Filter + sort defensively
    const labels = allLabels
      .filter((l) => !!l.id && !!l.name)
      // optional: remove noisy system labels
      .filter(
        (l) =>
          !l.id!.startsWith("CATEGORY_") &&
          !l.id!.startsWith("CHAT") &&
          l.id !== "UNREAD"
      )
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

    return NextResponse.json({
      ok: true,
      count: labels.length,
      labels,
    });
  } catch (err: any) {
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      "Failed to fetch Gmail labels";

    const isAuth =
      msg.includes("Invalid Credentials") ||
      msg.includes("invalid_grant") ||
      msg.includes("401");

    console.error("⚠️ Gmail labels error:", err?.response?.data || err);

    return NextResponse.json(
      {
        ok: false,
        error: msg,
        type: isAuth ? "auth" : "server",
      },
      { status: isAuth ? 401 : 400 }
    );
  }
}
