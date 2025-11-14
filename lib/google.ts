// lib/google.ts
import { google } from "googleapis";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

type TokenBundle = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null; // ms epoch
};

/**
 * Server-safe token loader.
 * - Primary source: NextAuth Account row (has refresh_token)
 * - Fallback: session.google (access_token + expires_at only)
 */
export async function loadGoogleTokens(): Promise<TokenBundle & { userId: string | null }> {
  const session = await getServerSession(authOptions);
  const userId = (session as any)?.userId ?? null;

  // Fallbacks from session (never includes refresh_token by design)
  const sessAccess = (session as any)?.google?.access_token ?? null;
  const sessExpires = (session as any)?.google?.expires_at ?? null;

  if (!userId) {
    return { userId: null, access_token: sessAccess, refresh_token: null, expires_at: sessExpires };
  }

  // Pull the persistent Google account for this user (NextAuth)
  const acct = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: {
      access_token: true,
      refresh_token: true,
      expires_at: true, // seconds since epoch in many NextAuth adapters
    },
  });

  // Normalize expires_at to ms
  const expires_ms =
    typeof acct?.expires_at === "number"
      ? (acct.expires_at > 10_000_000_000 ? acct.expires_at : acct.expires_at * 1000)
      : (typeof sessExpires === "number" ? sessExpires : null);

  return {
    userId,
    access_token: (acct?.access_token as string | null) ?? sessAccess ?? null,
    refresh_token: (acct?.refresh_token as string | null) ?? null,
    expires_at: expires_ms,
  };
}

/** Build OAuth2 client seeded with the best available tokens. */
export async function getGmailOAuthClient() {
  const { access_token, refresh_token, expires_at } = await loadGoogleTokens();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google env is missing");

  const oAuth2 = new google.auth.OAuth2(clientId, clientSecret);

  oAuth2.setCredentials({
    access_token: access_token ?? undefined,
    refresh_token: refresh_token ?? undefined,
    expiry_date: typeof expires_at === "number" ? expires_at : undefined,
  });

  return oAuth2;
}

/** Return a Gmail client that will auto-refresh when a refresh_token exists. */
export async function getGmail() {
  const auth = await getGmailOAuthClient();
  return google.gmail({ version: "v1", auth });
}

/**
 * Best-effort: ensure we hold a fresh access token before a long operation.
 * Returns the active access token (post-refresh if needed).
 */
export async function ensureFreshAccessToken(): Promise<string | null> {
  const auth = await getGmailOAuthClient();
  const creds = await auth.getAccessToken().catch(() => null);
  const tokenString =
    (typeof creds === "string" ? creds : creds?.token) ?? (auth as any).credentials?.access_token ?? null;
  return tokenString ?? null;
}

/** Helper: who am I? (useful sanity check) */
export async function getGmailProfileEmail(): Promise<string | null> {
  try {
    const gmail = await getGmail();
    const me = await gmail.users.getProfile({ userId: "me" });
    return me.data.emailAddress ?? null;
  } catch (err) {
    // swallow; callers treat null as “not connected/authorized”
    return null;
  }
}
