// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// Force Node runtime (Prisma + other adapters)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Use the NextAuth handler directly
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
