// middleware.ts (project root)
export { default } from "next-auth/middleware";

/**
 * Protect everything *except*:
 * - NextAuth endpoints (/api/auth/**)
 * - Public APIs you expose to websites/Retell/Shopify
 * - Marketing/onboarding pages (/login, /register, /complete)
 * - Public booking pages (/b/[slug])
 * - Next static/image assets & common public files
 *
 * Anything not excluded below will require an authenticated session.
 */
export const config = {
  matcher: [
    // Protect all pages except the public ones listed in the negative lookahead:
    // NOTE: order matters; this single regex keeps things simple and avoids overlaps.
    '/((?!' +
      [
        'api/auth',        // NextAuth callbacks
        'api/public',      // public JSON endpoints (availability/book)
        'api/retell',      // Retell webhooks/functions
        'api/shopify',     // Shopify webhooks
        '_next/static',    // Next.js static files
        '_next/image',     // Next.js image optimizer
        'favicon.ico',
        'robots.txt',
        'sitemap.xml',
        'manifest.webmanifest',
        'login',           // sign-in page
        'register',        // your onboarding
        'complete',        // purchase-complete/token flow
        'b/'               // public booking pages e.g. /b/salon-slug
      ].join('|') +
    ').*)',
  ],
};
