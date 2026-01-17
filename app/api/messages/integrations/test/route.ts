import { NextResponse } from "next/server";
import { requireSessionOrgFeature } from "@/lib/entitlements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type TestPayload = {
  channel?: "instagram" | "whatsapp";
  config?: {
    appId?: string;
    pageId?: string;
    igBusinessId?: string;
    phoneNumberId?: string;
    wabaId?: string;
    accessToken?: string;
  };
};

export async function POST(req: Request) {
  const gate = await requireSessionOrgFeature("messagesHub");
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  }

  const payload = (await req.json().catch(() => ({}))) as TestPayload;
  const channel = payload.channel;
  const config = payload.config || {};

  if (!channel) {
    return NextResponse.json({ ok: false, error: "Missing channel" }, { status: 400 });
  }

  if (channel === "instagram") {
    if (gate.entitlements && !gate.entitlements.channels.instagram.enabled) {
      return NextResponse.json({ ok: false, error: "Instagram channel disabled by entitlements" }, { status: 403 });
    }
    const missing = [
      !config.appId ? "appId" : null,
      !config.pageId ? "pageId" : null,
      !config.igBusinessId ? "igBusinessId" : null,
      !config.accessToken ? "accessToken" : null,
    ].filter(Boolean);
    if (missing.length) {
      return NextResponse.json({ ok: false, error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
  }

  if (channel === "whatsapp") {
    if (gate.entitlements && !gate.entitlements.channels.whatsapp.enabled) {
      return NextResponse.json({ ok: false, error: "WhatsApp channel disabled by entitlements" }, { status: 403 });
    }
    const missing = [
      !config.phoneNumberId ? "phoneNumberId" : null,
      !config.wabaId ? "wabaId" : null,
      !config.accessToken ? "accessToken" : null,
    ].filter(Boolean);
    if (missing.length) {
      return NextResponse.json({ ok: false, error: `Missing fields: ${missing.join(", ")}` }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, status: "connected" });
}
