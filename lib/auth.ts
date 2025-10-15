import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import EmailProvider from "next-auth/providers/email";
import { getServerSession, type NextAuthOptions } from "next-auth";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";

// -----------------------------
// Type Definitions
// -----------------------------
interface MembershipLite {
  orgId: string;
  role?: string;
}

type AppToken = JWT & {
  userId?: string;
  email?: string;
  name?: string;
  role?: string | null;
  isSuperAdmin?: boolean;
  orgIds?: string[];
  orgCount?: number;
};

// -----------------------------
// Environment Config
// -----------------------------
const SUPERADMINS = (process.env.SUPERADMINS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || "";

const EMAIL_SERVER = process.env.EMAIL_SERVER;
const EMAIL_FROM = process.env.EMAIL_FROM;

// -----------------------------
// Providers Setup
// -----------------------------
const providers: any[] = [
  CredentialsProvider({
    name: "Credentials",
    credentials: {
      email: { label: "Email", type: "email", placeholder: "you@example.com" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.trim().toLowerCase();
      const password = credentials?.password || "";

      if (!email || !password) throw new Error("Missing credentials");

      // 1️⃣ Superadmin fast path
      if (
        SUPERADMINS.includes(email) &&
        SUPERADMIN_PASSWORD &&
        password === SUPERADMIN_PASSWORD
      ) {
        const existing = await prisma.user.findUnique({ where: { email } });
        const userRow =
          existing ??
          (await prisma.user.create({
            data: { email, name: "Superadmin" },
          }));

        return {
          id: userRow.id,
          email: userRow.email!,
          name: userRow.name ?? "Superadmin",
          isSuperAdmin: true,
        };
      }

      // 2️⃣ Normal user lookup
      const user = await prisma.user.findUnique({
        where: { email },
        include: { memberships: { select: { orgId: true, role: true } } },
      });

      if (!user || !user.password) throw new Error("Invalid email or password");

      const valid = await compare(password, user.password);
      if (!valid) throw new Error("Invalid email or password");

      const role = user.memberships?.[0]?.role ?? null;

      return {
        id: user.id,
        email: user.email!,
        name: user.name ?? undefined,
        role,
        isSuperAdmin: SUPERADMINS.includes(email),
      };
    },
  }),
];

// Optional: Add EmailProvider for passwordless logins if env vars exist
if (EMAIL_SERVER && EMAIL_FROM) {
  providers.push(
    EmailProvider({
      server: EMAIL_SERVER,
      from: EMAIL_FROM,
    })
  );
}

// -----------------------------
// NextAuth Config
// -----------------------------
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  providers,
  pages: {
    signIn: "/login",
  },

  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: any }) {
      const t = token as AppToken;

      if (user) {
        t.userId = user.id ?? t.userId;
        t.email = user.email ?? t.email;
        t.name = user.name ?? t.name;
        t.role = user.role ?? t.role;
        t.isSuperAdmin = Boolean(user.isSuperAdmin);
      }

      // Refresh org info
      if (t.email) {
        try {
          const memberships: MembershipLite[] = await prisma.membership.findMany({
            where: { user: { email: t.email } },
            select: { orgId: true },
          });

          t.orgIds = memberships.map((m) => m.orgId);
          t.orgCount = t.orgIds.length;
        } catch {
          // ignore DB issues; token remains valid
        }
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

// -----------------------------
// Helper
// -----------------------------
export async function auth() {
  return getServerSession(authOptions);
}
