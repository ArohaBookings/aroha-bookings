import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

// 👇 These two lines must be at the very top
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
