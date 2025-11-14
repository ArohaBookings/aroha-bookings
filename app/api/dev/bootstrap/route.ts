// app/api/dev/bootstrap/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

/** Force Node runtime; never cache */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/** Tunables */
const DEFAULT_ORG_SLUG = "default";
const DEFAULT_ORG_NAME = "My Business";
const DEFAULT_TZ = "Pacific/Auckland";

/** Helper: JSON response with no-store */
function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

/** Quick superadmin check from env */
function isSuperadmin(email?: string | null): boolean {
  if (!email) return false;
  const list = (process.env.SUPERADMINS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/** Only allow POST + OPTIONS */
export async function GET() {
  return json({ ok: false, error: "Method Not Allowed" }, 405);
}
export async function PUT() { return GET(); }
export async function PATCH() { return GET(); }
export async function DELETE() { return GET(); }

/** CORS/preflight (optional) */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

/** Main bootstrap */
export async function POST() {
  // 1) Environment guard: block in production unless explicitly allowed
  const isProd = process.env.NODE_ENV === "production";
  const allowInProd = (process.env.ALLOW_DEV_BOOTSTRAP || "").toLowerCase() === "true";
  if (isProd && !allowInProd) {
    return json(
      {
        ok: false,
        error:
          "Bootstrap is disabled in production. Set ALLOW_DEV_BOOTSTRAP=true to override (temporarily).",
      },
      403
    );
  }

  // 2) Auth required
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return json({ ok: false, error: "Not signed in" }, 401);

  // 3) Optional superadmin guard (comment out if you want any signed-in user to be allowed locally)
  const requireSuperadmin = (process.env.REQUIRE_SUPERADMIN_FOR_BOOTSTRAP || "true").toLowerCase() === "true";
  if (requireSuperadmin && !isSuperadmin(email)) {
    return json({ ok: false, error: "Not authorized (superadmin required)" }, 403);
  }

  try {
    // 4) Fetch user (must exist via NextAuth)
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return json({ ok: false, error: "User not found" }, 404);

    // 5) Idempotent org + membership + seed EmailAISettings in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // a) Upsert org
      const org = await tx.organization.upsert({
        where: { slug: DEFAULT_ORG_SLUG },
        update: {
          name: DEFAULT_ORG_NAME,
          timezone: DEFAULT_TZ,
        },
        create: {
          name: DEFAULT_ORG_NAME,
          slug: DEFAULT_ORG_SLUG,
          timezone: DEFAULT_TZ,
          plan: "PROFESSIONAL", // matches your enum
        },
      });

      // b) Ensure membership (owner)
      await tx.membership.upsert({
        where: { userId_orgId: { userId: user.id, orgId: org.id } },
        update: { role: "owner" },
        create: { userId: user.id, orgId: org.id, role: "owner" },
      });

      // c) Seed EmailAISettings if missing (safe defaults)
      const settings = await tx.emailAISettings.upsert({
        where: { orgId: org.id },
        update: {}, // keep current if already exists
        create: {
          orgId: org.id,
          enabled: false,
          businessName: "Your business",
          businessHoursTz: DEFAULT_TZ,
          businessHoursJson: {}, // closed by default; UI can fill later
          defaultTone: "friendly, concise, local",
          instructionPrompt: "",
          signature: null,
          allowedSendersRegex: null,
          blockedSendersRegex: null,
          autoReplyRulesJson: [],
          minConfidenceToSend: 0.65,
          humanEscalationTags: [],
        },
      });

      return { org, settings };
    });

    // 6) Compose response with a couple of helpful hints
    return json({
      ok: true,
      message: "Bootstrap complete",
      org: {
        id: result.org.id,
        name: result.org.name,
        slug: result.org.slug,
        timezone: result.org.timezone,
        plan: result.org.plan,
      },
      emailAI: {
        seeded: !!result.settings?.id,
        enabled: result.settings.enabled,
      },
      tips: [
        "You can change the org name/plan in the Settings page or directly in the DB.",
        "Connect Google on /email-ai to enable Gmail features.",
      ],
    });
  } catch (e: any) {
    console.error("Bootstrap failed:", e);
    // Prisma error messages are sometimes noisy; keep return concise
    return json({ ok: false, error: "Bootstrap failed", detail: String(e?.message || e) }, 500);
  }
}
