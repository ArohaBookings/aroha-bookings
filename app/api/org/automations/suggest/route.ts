import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { AutomationRule } from "@/lib/automation/rules";
import { suggestRulesCopy } from "@/lib/ai/automation";

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

export async function GET() {
  const org = await requireOrg();
  if (!org) return json({ ok: false, error: "Not authorized" }, 401);

  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const appts = await prisma.appointment.findMany({
    where: { orgId: org.id, startsAt: { gte: since } },
    select: { status: true },
  });

  const total = appts.length || 1;
  const noShows = appts.filter((a) => a.status === "NO_SHOW").length;
  const noShowRate = noShows / total;

  const rules: AutomationRule[] = [];
  if (noShowRate > 0.08) {
    rules.push({
      id: "suggest_no_show_confirm",
      enabled: true,
      when: { type: "NO_SHOW_COUNT", threshold: 2, windowDays: 60 },
      then: { action: "REQUIRE_CONFIRMATION" },
    });
    rules.push({
      id: "suggest_no_show_flag",
      enabled: true,
      when: { type: "NO_SHOW_COUNT", threshold: 1, windowDays: 30 },
      then: { action: "FLAG_CLIENT" },
    });
  }

  if (total > 30) {
    rules.push({
      id: "suggest_repeat_skip",
      enabled: true,
      when: { type: "REPEAT_CLIENT", threshold: 3, windowDays: 90 },
      then: { action: "SKIP_REMINDER" },
    });
  }

  const summary = `No-show rate is ${(noShowRate * 100).toFixed(1)}% over the last 90 days.`;
  const note = await suggestRulesCopy({ orgName: org.name, summary });

  return json({ ok: true, rules, note: note.text, ai: note.ai });
}
