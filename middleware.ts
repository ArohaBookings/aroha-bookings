// middleware.ts (project root)
export { default } from "next-auth/middleware";

/**
 * We protect only the authenticated app areas.
 * Public routes (NOT matched here) remain accessible:
 *   - /login, /register, /complete
 *   - /b/[slug] (public booking pages)
 *   - /api/public/**, /api/retell/**, /api/shopify/**, /api/dev/**
 *   - Next static/image and common public files
 *
 * If you add new private sections, just append another "/segment/:path*".
 */
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/calendar/:path*",
    "/clients/:path*",
    "/settings/:path*",
    "/o/:path*",           // org-specific app area
    "/admin/:path*",       // future admin console
    "/reports/:path*",     // future analytics
    "/staff/:path*",       // future staff tools
  ],
};
