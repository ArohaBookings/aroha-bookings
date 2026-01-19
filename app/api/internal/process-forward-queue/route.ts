import { NextResponse } from "next/server";
import { processForwardQueue } from "@/lib/retell/forwardProcessor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function isAuthorized(req: Request) {
  const secret = (process.env.INTERNAL_JOB_SECRET || "").trim();
  if (!secret) return false;
  const header = req.headers.get("x-internal-secret") || "";
  return header === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  const result = await processForwardQueue({ limit: 50 });
  return json({ ok: true, ...result });
}
