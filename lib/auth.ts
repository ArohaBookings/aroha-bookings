// lib/auth.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";

/* ───────────────────────────────────────────────────────────────
   ENV / CONFIG (validate strictly in prod, warn in dev)
────────────────────────────────────────────────────────────── */
const RUNTIME_ENV = process.env.NODE_ENV || "development";
const isProd = RUNTIME_ENV === "production";
const isDev = !isProd;

function req(name: string): string {
  const v = process.env[name];
  if (!v && isProd) throw new Error(`[auth] Missing required env: ${name}`);
  if (!v && isDev) console.warn(`[auth] Missing env (dev): ${name}`);
  return (v || "").trim();
}

const NEXTAUTH_SECRET = req("NEXTAUTH_SECRET");
const NEXTAUTH_URL = req("NEXTAUTH_URL");

const EMAIL_SERVER = (process.env.EMAIL_SERVER || "").trim();
const EMAIL_FROM = (process.env.EMAIL_FROM || "").trim();

const SUPERADMINS = (process.env.SUPERADMINS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const SUPERADMIN_PASSWORD = (process.env.SUPERADMIN_PASSWORD || "").trim();

const GOOGLE_CLIENT_ID = req("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = req("GOOGLE_CLIENT_SECRET");
const GOOGLE_GMAIL_SCOPES =
  (process.env.GOOGLE_GMAIL_SCOPES ||
    "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send").trim();

/* ───────────────────────────────────────────────────────────────
   TYPES
────────────────────────────────────────────────────────────── */
type LiteMembership = { orgId: string; role?: string | null };

type AppToken = JWT & {
  userId?: string;
  email?: string;
  name?: string;
  role?: string | null;
  isSuperAdmin?: boolean;
  orgIds?: string[];
  orgCount?: number;

  google_access_token?: string | null;
  google_refresh_token?: string | null;
  google_expires_at?: number | null; // ms epoch
};

type UserWithPasswordMaybe = {
  id: string;
  email: string | null;
  name: string | null;
  password?: string | null;
  memberships?: LiteMembership[];
};

/* ───────────────────────────────────────────────────────────────
   UTILS
────────────────────────────────────────────────────────────── */
const isSuperAdminEmail = (email?: string | null) =>
  !!email && SUPERADMINS.includes(email.trim().toLowerCase());

function safeRedirect(url: string, baseUrl: string): string {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url, baseUrl);
    if (target.origin !== base.origin) return baseUrl;
    if (target.pathname.startsWith("/login")) return baseUrl;
    return target.toString();
  } catch {
    return baseUrl;
  }
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Silent Google access token refresh (keeps JWT small, retries once). */
async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<{ access_token?: string; expires_at?: number } | null> {
  const body = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        timeoutMs: 15000,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        if (isDev) console.warn(`[auth] Google refresh failed ${res.status}: ${txt}`);
        continue;
      }
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) return null;
      const expires_at =
        typeof json.expires_in === "number"
          ? Date.now() + json.expires_in * 1000
          : Date.now() + 3_300_000; // ~55m default
      return { access_token: json.access_token, expires_at };
    } catch (err) {
      if (isDev) console.warn(`[auth] Google refresh error (attempt ${attempt}):`, err);
    }
  }
  return null;
}

/* ───────────────────────────────────────────────────────────────
   PROVIDERS
────────────────────────────────────────────────────────────── */
const providers = [
  CredentialsProvider({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email", placeholder: "you@example.com" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase() || "";
      const password = credentials?.password || "";
      if (!email || !password) throw new Error("Missing credentials");

      // Superadmin guard-path (no hash compare; gated by env)
      if (isSuperAdminEmail(email) && SUPERADMIN_PASSWORD && password === SUPERADMIN_PASSWORD) {
        const userRow =
          (await prisma.user.findUnique({ where: { email } })) ??
          (await prisma.user.create({ data: { email, name: "Superadmin" } }));

        const membership = await prisma.membership.findFirst({ where: { userId: userRow.id } });
        if (!membership) {
          const org = await prisma.organization.create({
            data: { name: "Superadmin Org", slug: `superadmin-${userRow.id.slice(0, 6)}` },
          });
          await prisma.membership.create({
            data: { userId: userRow.id, orgId: org.id, role: "owner" },
          });
        }

        return {
          id: userRow.id,
          email: userRow.email!,
          name: userRow.name ?? "Superadmin",
          isSuperAdmin: true,
        };
      }

      // Normal path
      const user = (await prisma.user.findUnique({
        where: { email },
        include: { memberships: { select: { orgId: true, role: true } } },
      })) as UserWithPasswordMaybe | null;

      if (!user?.password) throw new Error("Invalid email or password");
      const ok = await compare(password, user.password);
      if (!ok) throw new Error("Invalid email or password");

      const role = user.memberships?.[0]?.role ?? null;
      return {
        id: user.id,
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        role,
        isSuperAdmin: isSuperAdminEmail(email),
      };
    },
  }),

  ...(EMAIL_SERVER && EMAIL_FROM
    ? [EmailProvider({ server: EMAIL_SERVER, from: EMAIL_FROM })]
    : []),

  GoogleProvider({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    authorization: {
      params: {
        scope: GOOGLE_GMAIL_SCOPES,
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    },
    // prevent short callback timeouts during OAuth exchanges
    httpOptions: { timeout: 15000 },
  }),
];

/* ───────────────────────────────────────────────────────────────
   NEXTAUTH OPTIONS (bullet-proofed)
────────────────────────────────────────────────────────────── */
const baseAuthOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers,
  session: { strategy: "jwt" },
  // @ts-ignore supported at runtime
  trustHost: true,
  secret: NEXTAUTH_SECRET,
  pages: { signIn: "/login", error: "/login" },

  callbacks: {
    async redirect({ url, baseUrl }) {
      return safeRedirect(url, baseUrl || NEXTAUTH_URL);
    },

    /** JWT is our single source of truth for app + Google tokens. */
    async jwt({ token, user, account }) {
      const t = token as AppToken;

      // 1) Map user fields after any sign-in
      if (user) {
        t.userId = (user as any).id ?? t.userId ?? null;
        t.email = (user as any).email ?? t.email ?? null;
        t.name = (user as any).name ?? t.name ?? null;
        t.role = (user as any).role ?? t.role ?? null;
        t.isSuperAdmin = Boolean((user as any).isSuperAdmin) || t.isSuperAdmin || false;
      }

      // 2) Capture Google tokens; NEVER drop an existing refresh token
      if (account?.provider === "google") {
        t.google_access_token = (account.access_token as string) ?? t.google_access_token ?? null;
        t.google_refresh_token =
          (account.refresh_token as string) ?? t.google_refresh_token ?? null; // keep old
        t.google_expires_at = account.expires_at
          ? Number(account.expires_at) * 1000
          : t.google_expires_at ?? Date.now() + 3_300_000; // ~55m default
      }

      // 3) Silent refresh near/after expiry (1m skew). If refresh fails, we only clear the access token.
      const now = Date.now();
      const skew = 60_000;
      if (
        t.google_refresh_token &&
        t.google_expires_at &&
        t.google_expires_at - skew <= now
      ) {
        const refreshed = await refreshGoogleAccessToken(t.google_refresh_token);
        if (refreshed?.access_token) {
          t.google_access_token = refreshed.access_token;
          t.google_expires_at = refreshed.expires_at ?? now + 3_300_000;
        } else {
          // keep refresh token; UI can still be "connected" and the client can trigger a live probe
          t.google_access_token = null;
        }
      }

      // 4) Enrich with memberships once (cached on JWT)
      if (t.email && !t.orgIds) {
        try {
          const memberships = (await prisma.membership.findMany({
            where: { user: { email: t.email } },
            select: { orgId: true, role: true },
          })) as Array<{ orgId: string; role: string | null }>;
          t.orgIds = memberships.map((m) => m.orgId);
          t.orgCount = memberships.length;
          if (!t.role) t.role = memberships[0]?.role ?? null;
        } catch (e) {
          if (isDev) console.warn("[auth] membership fetch failed:", e);
        }
      }

      return t;
    },

    /** Only expose non-sensitive fields to the browser. */
    async session({ session, token }: { session: Session; token: JWT }) {
      const t = token as AppToken;

      (session as any).userId = t.userId ?? null;
      (session as any).isSuperAdmin = Boolean(t.isSuperAdmin);
      (session as any).role = t.role ?? null;
      (session as any).orgIds = t.orgIds ?? [];
      (session as any).orgCount = t.orgCount ?? 0;

      if (session.user) {
        session.user.email = t.email ?? session.user.email;
        session.user.name = t.name ?? session.user.name;
      }

      // Never send refresh token to client
      (session as any).google = {
        access_token: t.google_access_token ?? null,
        expires_at: t.google_expires_at ?? null,
        has_refresh_token: Boolean(t.google_refresh_token),
      };

      return session;
    },
  },
};

// attach events separately to dodge strict type versions complaining
(baseAuthOptions as any).events = {
  async signIn(message: any) {
    if (isDev) console.log("[auth] signIn", { provider: message?.account?.provider });
  },
  async signOut(message: any) {
    if (isDev) console.log("[auth] signOut", { sessionId: message?.session?.sessionToken });
  },
  async error(message: any) {
    // concise; the /login page will show the user-facing error
    console.warn("[auth] event error:", message?.error?.name || message);
  },
};

export const authOptions = baseAuthOptions;

/* ───────────────────────────────────────────────────────────────
   SERVER HELPER
────────────────────────────────────────────────────────────── */
export async function auth() {
  return getServerSession(authOptions);
}
