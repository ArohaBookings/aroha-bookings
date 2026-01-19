import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canAccessSuperAdminByEmail } from "@/lib/roles";
import { retellListCalls } from "@/lib/retell/client";

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

export async function GET(req: Request) {
  const auth = await requireSuperadmin();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(req.url);
  const orgId = (url.searchParams.get("orgId") || "").trim();
  if (!orgId) return json({ ok: false, error: "Missing orgId" }, 400);

  const connection = await prisma.retellConnection.findFirst({
    where: { orgId, active: true },
    select: { agentId: true, apiKeyEncrypted: true },
  });

  if (!connection?.agentId) {
    return json({ ok: false, error: "No Retell connection found" }, 400);
  }

  const apiKey = connection.apiKeyEncrypted || process.env.RETELL_API_KEY || "";
  if (!apiKey) {
    return json({ ok: false, error: "Missing Retell API key" }, 400);
  }

  const result = await retellListCalls({
    agentId: connection.agentId,
    apiKey,
    limit: 5,
  });

  if (!result.ok) {
    return json(
      {
        ok: false,
        tried: result.tried,
        chosenUrl: result.chosenUrl,
        sampleCount: 0,
        error: "Retell ping failed",
      },
      502
    );
  }

  return json({
    ok: true,
    tried: result.tried,
    chosenUrl: result.chosenUrl,
    sampleCount: result.calls.length,
  });
}
