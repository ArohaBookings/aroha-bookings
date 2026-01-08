// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Public pages/assets that never require auth
const PUBLIC_PATHS = [
  "/",            // marketing homepage
  "/login",
  "/register",
  "/api/auth",    // NextAuth routes
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
  "/static",
  "/_next",
];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Allow public paths and assets straight through
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 2) Only gate the app areas
  const needsAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/calendar") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/settings");

  if (!needsAuth) {
    return NextResponse.next();
  }

  // 3) Check for NextAuth session cookie (JWT strategy)
  const hasSession =
    !!req.cookies.get("next-auth.session-token") ||
    !!req.cookies.get("__Secure-next-auth.session-token");

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set(
      "callbackUrl",
      req.nextUrl.pathname + req.nextUrl.search,
    );
    return NextResponse.redirect(url);
  }

  // 4) Logged in → let the server components / helpers
  //     (requireOrgOrPurchase, /unauthorized etc.) handle purchase checks
  return NextResponse.next();
}

// Apply middleware everywhere except static assets
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|images|favicon.ico).*)",
  ],
};
