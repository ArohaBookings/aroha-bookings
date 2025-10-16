// lib/auth.ts
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";

/* ────────────────────────────────────────────────────────────────────────────
   ENV / CONFIG
──────────────────────────────────────────────────────────────────────────── */

const SUPERADMINS: string[] = (process.env.SUPERADMINS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const SUPERADMIN_PASSWORD = (process.env.SUPERADMIN_PASSWORD || "").trim();

const EMAIL_SERVER = (process.env.EMAIL_SERVER || "").trim(); // optional
const EMAIL_FROM = (process.env.EMAIL_FROM || "").trim();     // optional

export function isSuperAdminEmail(email?: string | null): boolean {
  return !!email && SUPERADMINS.includes(email.trim().toLowerCase());
}

/* ────────────────────────────────────────────────────────────────────────────
   LOCAL TYPES (no @prisma/client imports required)
──────────────────────────────────────────────────────────────────────────── */

type MembershipLite = { orgId: string; role?: string | null };

type AppToken = JWT & {
  userId?: string;
  email?: string;
  name?: string;
  role?: string | null;
  isSuperAdmin?: boolean;
  orgIds?: string[];
  orgCount?: number;
};

type UserWithOptionalPassword = {
  id: string;
  email: string | null;
  name: string | null;
  password?: string | null;
  memberships?: MembershipLite[];
};

/* ────────────────────────────────────────────────────────────────────────────
   PROVIDERS
──────────────────────────────────────────────────────────────────────────── */

const providers: any[] = [
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

      // Superadmin fast-path
      if (isSuperAdminEmail(email) && SUPERADMIN_PASSWORD && password === SUPERADMIN_PASSWORD) {
        const existing = await prisma.user.findUnique({ where: { email } });
        const userRow =
          existing ?? (await prisma.user.create({ data: { email, name: "Superadmin" } }));
        return {
          id: userRow.id,
          email: userRow.email!,
          name: userRow.name ?? "Superadmin",
          isSuperAdmin: true,
        };
      }

      // Normal user
      const user = (await prisma.user.findUnique({
        where: { email },
        include: { memberships: { select: { orgId: true, role: true } } },
      })) as UserWithOptionalPassword | null;

      if (!user || !user.password) throw new Error("Invalid email or password");
      const valid = await compare(password, user.password);
      if (!valid) throw new Error("Invalid email or password");

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
];

if (EMAIL_SERVER && EMAIL_FROM) {
  providers.push(EmailProvider({ server: EMAIL_SERVER, from: EMAIL_FROM }));
}

/* ────────────────────────────────────────────────────────────────────────────
   NEXTAUTH OPTIONS
──────────────────────────────────────────────────────────────────────────── */

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/login",
    error: "/login",
  },

  // Let NextAuth trust Vercel preview hosts (prevents /login callback loops).
  // The ts-ignore keeps older @types from complaining; runtime supports it.
  // @ts-ignore
  trustHost: true,

  callbacks: {
    // Guard redirects to avoid login↔callback loop and open redirects
    async redirect({ url, baseUrl }) {
      try {
        const base = new URL(baseUrl);
        const target = new URL(url, baseUrl);

        // Same-origin only
        if (target.origin !== base.origin) return baseUrl;

        // If we’re already on /login (or pointing back to it), don’t keep bouncing
        if (target.pathname.startsWith("/login")) return baseUrl;

        return target.toString();
      } catch {
        return baseUrl;
      }
    },

    async jwt({ token, user }) {
      const t = token as AppToken;
      if (user) {
        t.userId = (user as any).id ?? t.userId;
        t.email = (user as any).email ?? t.email;
        t.name = (user as any).name ?? t.name;
        t.role = (user as any).role ?? t.role;
        t.isSuperAdmin = Boolean((user as any).isSuperAdmin);
      }

      if (t.email) {
        try {
          const memberships = (await prisma.membership.findMany({
            where: { user: { email: t.email } },
            select: { orgId: true, role: true },
          })) as MembershipLite[];
          t.orgIds = memberships.map((m) => m.orgId);
          t.orgCount = t.orgIds.length;
        } catch {}
      }
      return t;
    },

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
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

/* ────────────────────────────────────────────────────────────────────────────
   SERVER HELPER
──────────────────────────────────────────────────────────────────────────── */

export async function auth() {
  return getServerSession(authOptions);
}
