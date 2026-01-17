import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { simulateRulesForAppointment, type AutomationRule } from "@/lib/automation/rules";
import { explainSimulation } from "@/lib/ai/automation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

async function requireOrg() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const membership = await prisma.membership.findFirst({
    where: { user: { email: session.user.email } },
    include: { org: true },
  });
  return membership?.org || null;
}

export async function POST(req: Request) {
  const org = await requireOrg();
  if (!org) return json({ ok: false, error: "Not authorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as {
    appointmentId?: string;
    rules?: AutomationRule[];
  };

  const appointmentId = (body.appointmentId || "").trim();
  if (!appointmentId) {
    return json({ ok: false, error: "Missing appointmentId" }, 400);
  }

  const rules = Array.isArray(body.rules) ? body.rules : [];
  const results = await simulateRulesForAppointment({ orgId: org.id, appointmentId, rules });
  const summary = await explainSimulation({ orgName: org.name, results });

  return json({
    ok: true,
    results,
    explanation: summary.text,
    ai: summary.ai,
  });
}
