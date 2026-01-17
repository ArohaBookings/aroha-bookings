import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminContext } from "@/app/api/org/appointments/utils";
import { storeClientGuardrails } from "@/lib/clientSignals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = (await req.json().catch(() => ({}))) as {
    guardrail?: Record<string, unknown>;
  };
  const guardrail = body.guardrail && typeof body.guardrail === "object" ? body.guardrail : null;
  if (!guardrail) {
    return json({ ok: false, error: "Missing guardrail payload" }, 400);
  }

  const customer = await prisma.customer.findUnique({
    where: { id: ctx.params.id },
    select: { id: true, orgId: true },
  });
  if (!customer || customer.orgId !== auth.orgId) {
    return json({ ok: false, error: "Customer not found" }, 404);
  }

  await storeClientGuardrails(auth.orgId, customer.id, guardrail);
  return json({ ok: true });
}
