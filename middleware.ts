// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = [
  "/",                // marketing homepage
  "/login",
  "/register",
  "/api/auth",        // next-auth routes
  "/_next",           // assets
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/static",          // if you have one
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Allow all public assets and auth endpoints through
  if (isPublicPath(pathname)) return NextResponse.next();

  // If you don’t want global protection, you can remove the rest of this file.
  // If you DO want protection on app pages, only gate specific areas:
  const needsAuth = pathname.startsWith("/dashboard")
                 || pathname.startsWith("/calendar")
                 || pathname.startsWith("/clients")
                 || pathname.startsWith("/settings");

  if (!needsAuth) return NextResponse.next();

  // Read the session cookie (NextAuth default session token name for JWT strategy)
  const hasSession = Boolean(req.cookies.get("next-auth.session-token") ?? req.cookies.get("__Secure-next-auth.session-token"));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except _next/static etc; we still early-return on PUBLIC_PATHS above
    "/((?!_next/static|_next/image|images|favicon.ico).*)",
  ],
};
