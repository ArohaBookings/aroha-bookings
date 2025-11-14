// app/api/email-ai/token/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getGmailProfileEmail } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

// Treat tokens expiring within 60s as effectively expired
const isFresh = (msEpoch?: number | null) =>
  typeof msEpoch === "number" && msEpoch > Date.now() + 60_000;

/** Normalize session.google into a predictable shape */
function readGoogleFromSession(session: any) {
  const g = (session?.google ?? {}) as {
    access_token?: string | null;
    expires_at?: number | null;
    has_refresh_token?: boolean;
  };

  return {
    access_token: g.access_token ?? null,
    expires_at: typeof g.expires_at === "number" ? g.expires_at : null,
    // NOTE: we never expose the refresh token itself to the client; only a boolean
    has_refresh_token: Boolean(g.has_refresh_token),
  };
}

/** Decide connectivity without flapping on transient access-token gaps */
function computeConnectivity(g: { access_token: string | null; expires_at: number | null; has_refresh_token: boolean }) {
  const hasFreshAccess = !!g.access_token && (g.expires_at ? isFresh(g.expires_at) : true);

  if (hasFreshAccess) {
    return { connected: true, reason: "access_token_fresh" as const };
  }
  if (g.has_refresh_token) {
    // We can fetch a fresh access token on demand via jwt() refresh; call this "standby connected"
    return { connected: true, reason: "has_refresh_token_only" as const };
  }
  return { connected: false, reason: "no_tokens" as const };
}

/** GET /api/email-ai/token
 *  Optional: ?probe=1 to live-check Gmail profile
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const doProbe = url.searchParams.get("probe") === "1";

    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { ok: false, connected: false, error: "Not authenticated" },
        { status: 401, headers: NO_STORE }
      );
    }

    // Read tokens exposed by our session() callback (never includes refresh token value)
    const g = readGoogleFromSession(session);
    const { connected, reason } = computeConnectivity(g);

    let live_ok: boolean | null = null;
    let live_email: string | null = null;

    // Optional: perform a tiny live probe so the UI can show “Verified ✓”
    if (doProbe && connected) {
      try {
        live_email = await getGmailProfileEmail();
        live_ok = !!live_email;
      } catch (e) {
        // Live probe failed (network, scopes, revoked, etc.). Don’t hard-fail the endpoint.
        live_ok = false;
        live_email = null;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        connected,
        connected_reason: reason, // "access_token_fresh" | "has_refresh_token_only" | "no_tokens"
        email: session.user.email,
        expires_at: g.expires_at, // ms epoch or null
        has_refresh_token: g.has_refresh_token,
        // optional diagnostics if ?probe=1
        live_ok,
        live_email,
      },
      { headers: NO_STORE }
    );
  } catch (err: any) {
    console.error("GET /api/email-ai/token error:", err);
    return NextResponse.json(
      {
        ok: false,
        connected: false,
        error: err?.message || "Server error",
      },
      { status: 500, headers: NO_STORE }
    );
  }
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Method Not Allowed" },
    { status: 405, headers: { ...NO_STORE, Allow: "GET, OPTIONS" } }
  );
}

// Optional CORS preflight (handy if UI ever lives on a different origin)
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": process.env.NEXTAUTH_URL || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...NO_STORE,
    },
  });
}
