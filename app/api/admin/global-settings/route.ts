import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSuperAdminByEmail } from "@/lib/roles";
import { readGlobalZapierUrl, writeGlobalZapierUrl } from "@/lib/retell/forwardQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireSuperadmin() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return { ok: false, error: "Not signed in", status: 401 } as const;
  const allowed = await canAccessSuperAdminByEmail(email);
  if (!allowed) return { ok: false, error: "Not authorized", status: 403 } as const;
  return { ok: true } as const;
}

export async function GET() {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const globalZapierWebhookUrl = await readGlobalZapierUrl();
  return json({ ok: true, globalZapierWebhookUrl });
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as { globalZapierWebhookUrl?: string | null };
  const url = typeof body.globalZapierWebhookUrl === "string" ? body.globalZapierWebhookUrl : null;
  const saved = await writeGlobalZapierUrl(url);
  return json({ ok: true, globalZapierWebhookUrl: saved });
}
