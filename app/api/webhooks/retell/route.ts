// app/api/webhooks/retell/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const message = "This endpoint has moved. Use /api/webhooks/voice/retell/{orgId}.";
  return NextResponse.json({ ok: false, error: message }, { status: 410 });
}
