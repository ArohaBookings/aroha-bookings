// middleware.ts  (✅ place at project root)
import { withAuth } from "next-auth/middleware";

// If a user hits a protected URL without a session, NextAuth will
// redirect them to this sign-in page.
export default withAuth({
  pages: {
    signIn: "/api/auth/signin",
  },
});

// Protect only the internal app surfaces.
// Everything else stays public (/, /register/*, /api/*, assets, webhook, etc).
export const config = {
  matcher: [
    // app sections that require an authenticated session
    "/dashboard",
    "/calendar",
    "/clients",
    "/settings",
    "/o/:path*",
  ],
};
