// middleware.ts (project root)
export { default } from "next-auth/middleware";

/**
 * Protect everything except:
 * - NextAuth endpoints (/api/auth/**)
 * - Public APIs (/api/public/**, /api/retell/**, /api/shopify/**, /api/dev/**)
 * - Public booking pages (/b/[slug])
 * - Marketing/onboarding pages (/login, /register, /complete)
 * - Next static/image assets & common public files
 */
export const config = {
  matcher: [
    // Negative lookahead: exclude listed prefixes/files, protect everything else.
    '/((?!api/auth|api/public|api/retell|api/shopify|api/dev|_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|manifest\\.webmanifest|login|register|complete|b/).*)',
  ],
};
