// app/api/email-ai/settings/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireSessionOrgFeature } from "@/lib/entitlements";
import { readGmailIntegration } from "@/lib/orgSettings";

// ─────────────────────────────────────────────
// Environment / Route config
// ─────────────────────────────────────────────
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      ...(extraHeaders || {}),
    },
  });
}

/** Compile regex safely (supports "/foo/i" or "foo") */
function safeRegex(pattern?: string | null) {
  if (!pattern) return null;
  try {
    const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
    // just validate – throws if invalid
    // eslint-disable-next-line no-new
    new RegExp(m ? m[1] : pattern, m ? m[2] : "i");
    return null;
  } catch (e: any) {
    return e?.message || "Invalid regular expression";
  }
}

/** Auth + org context */
async function getAuthedContext() {
  const gate = await requireSessionOrgFeature("emailAi");
  if (!gate.ok) {
    return { error: gate.error || "Not authorized", status: gate.status };
  }

  await getServerSession(authOptions);
  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: gate.orgId },
    select: { data: true },
  });
  const data = (orgSettings?.data as Record<string, unknown>) || {};
  const gmailConnected = readGmailIntegration(data).connected;
  return { orgId: gate.orgId, googleConnected: gmailConnected, gmailConnected };
}

// ─────────────────────────────────────────────
// Zod Schemas
// ─────────────────────────────────────────────
const regexField = z.preprocess(
  (v) => {
    if (v === undefined) return undefined;
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t || t === "__INVALID__") return null;
    return t;
  },
  z.string().max(400).nullable().optional()
);

const HoursTuple = z
  .tuple([
    z.coerce.number().int().min(0).max(1440),
    z.coerce.number().int().min(0).max(1440),
  ])
  .refine(([a, b]) => a <= b, { message: "open must be <= close" });

const HoursJson = z
  .record(
    z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
    HoursTuple.optional()
  )
  .default({});

const RulesJson = z.array(z.unknown()).max(1000).default([]);

/** Shape of the per-org knowledge base JSON */
const KnowledgeBaseSchema = z
  .object({
    overview: z.string().max(8000).optional(),
    services: z.string().max(8000).optional(),
    locations: z.string().max(8000).optional(),
    faqs: z.string().max(12000).optional(),
    alwaysMention: z.string().max(8000).optional(),
    neverMention: z.string().max(8000).optional(),
  })
  .passthrough();

const ModelEnum = z.enum([
  "gpt-5-mini",
  "gpt-5.1",
  "gpt-4.1-mini",
  "gpt-4.1",
]);

const SettingsSchema = z.object({
  enabled: z.coerce.boolean().optional(),
  businessName: z.string().trim().min(1).max(120).optional(),
  signature: z.string().max(2000).nullable().optional(),
  defaultTone: z.string().trim().min(1).max(200).optional(),
  instructionPrompt: z.string().max(8000).optional(),
  businessHoursTz: z.string().trim().min(1).max(120).optional(),
  businessHoursJson: HoursJson.optional(),
  allowedSendersRegex: regexField,
  blockedSendersRegex: regexField,
  autoReplyRulesJson: RulesJson.optional(),
  minConfidenceToSend: z.coerce.number().min(0).max(1).optional(),
  humanEscalationTags: z
    .array(z.string().trim().min(1).max(40))
    .max(200)
    .optional(),

  // NEW FIELDS
  autoSendAboveConfidence: z.coerce.boolean().optional(),
  model: ModelEnum.optional(),
  logRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  knowledgeBaseJson: KnowledgeBaseSchema.optional(),
});

// ─────────────────────────────────────────────
// GET
// ─────────────────────────────────────────────
export async function GET() {
  const ctx = await getAuthedContext();
  if ("error" in ctx) return json({ ok: false, error: ctx.error }, ctx.status);

  const settings = await prisma.emailAISettings.findUnique({
    where: { orgId: ctx.orgId },
  });

  return json({
    ok: true,
    orgId: ctx.orgId,
    googleConnected: ctx.googleConnected,
    gmailConnected: ctx.gmailConnected,
    settings: settings ?? null,
  });
}

// ─────────────────────────────────────────────
// POST (Upsert Settings)
// ─────────────────────────────────────────────
export async function POST(req: Request) {
  const ctx = await getAuthedContext();
  if ("error" in ctx) return json({ ok: false, error: ctx.error }, ctx.status);

  let raw: string;
  try {
    raw = await req.text();
    if (raw.length > 512 * 1024)
      return json({ ok: false, error: "Payload too large" }, 413);
  } catch {
    return json({ ok: false, error: "Invalid request body" }, 400);
  }

  let payload: any;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  // Defensive cleanup (but DO NOT strip templates anymore)
  try {
    if (Array.isArray(payload?.autoReplyRulesJson)) {
      // previously we filtered out __type === "template" here (now removed)
      // leave bundle as-is: templates + rules live together
    }

    const fix = (v: any) =>
      typeof v === "string" && (v.trim() === "" || v === "__INVALID__")
        ? null
        : v;
    payload.allowedSendersRegex = fix(payload.allowedSendersRegex);
    payload.blockedSendersRegex = fix(payload.blockedSendersRegex);
  } catch {
    // ignore cleanup errors
  }

  const parsed = SettingsSchema.safeParse(payload);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const firstMsg =
      flat.formErrors?.[0] ||
      (Object.values(flat.fieldErrors || {}).flat()[0] as string | undefined) ||
      "Validation failed";
    return json({ ok: false, error: firstMsg, issues: flat }, 400);
  }
  const data = parsed.data;

  if (data.enabled === true && !ctx.gmailConnected) {
    return json(
      { ok: false, error: "Connect Gmail before enabling Email AI" },
      400
    );
  }

  const allowErr = safeRegex(data.allowedSendersRegex ?? null);
  if (allowErr)
    return json(
      { ok: false, error: `allowedSendersRegex: ${allowErr}` },
      400
    );
  const blockErr = safeRegex(data.blockedSendersRegex ?? null);
  if (blockErr)
    return json(
      { ok: false, error: `blockedSendersRegex: ${blockErr}` },
      400
    );

      // DB Save
  try {
    const hoursJson = (data.businessHoursJson ?? {}) as Prisma.InputJsonValue;
    const autoRulesJson = (data.autoReplyRulesJson ?? []) as Prisma.InputJsonValue;
    const humanTagsJson = (data.humanEscalationTags ?? []) as Prisma.InputJsonValue;
    const kbJson = (data.knowledgeBaseJson ?? {}) as Prisma.InputJsonValue;

    const {
      businessHoursJson: _bh,
      autoReplyRulesJson: _ar,
      humanEscalationTags: _ht,
      knowledgeBaseJson: _kb,
      ...rest
    } = data;

    // use `any` so TS doesn't complain about new fields
    const createData: any = {
      organization: { connect: { id: ctx.orgId } },

      // sensible defaults; anything in `rest` overrides these
      enabled: false,
      googleAccountEmail: undefined,
      signature: null,
      businessName: "Your business",
      businessHoursTz: "Pacific/Auckland",
      businessHoursJson: hoursJson,
      defaultTone: "friendly, concise, local",
      instructionPrompt: "",
      allowedSendersRegex: null,
      blockedSendersRegex: null,
      autoReplyRulesJson: autoRulesJson,
      minConfidenceToSend: 0.65,
      humanEscalationTags: humanTagsJson,
      knowledgeBaseJson: kbJson,

      // this brings in: autoSendAboveConfidence, model, logRetentionDays, etc.
      ...rest,
    };

    const updateData: any = {
      ...rest,
      businessHoursJson: hoursJson,
      autoReplyRulesJson: autoRulesJson,
      humanEscalationTags: humanTagsJson,
      knowledgeBaseJson: kbJson,
      // let googleAccountEmail be set explicitly via rest if you ever add it
      googleAccountEmail: undefined,
    };

    const s = await prisma.emailAISettings.upsert({
      where: { orgId: ctx.orgId },
      create: createData,
      update: updateData,
    });

    return json(
      { ok: true, orgId: ctx.orgId, googleConnected: ctx.googleConnected, gmailConnected: ctx.gmailConnected, settings: s },
      200
    );
  } catch (e: any) {
    return json(
      { ok: false, error: e?.message || "Database error" },
      500
    );
  }
}

// ─────────────────────────────────────────────
// OPTIONS (CORS preflight, optional)
// ─────────────────────────────────────────────
export async function OPTIONS() {
  return json(
    { ok: true },
    200,
    {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
  );
}
