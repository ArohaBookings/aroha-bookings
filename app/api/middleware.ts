import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(_req: NextRequest) {
  // do nothing for now
  return NextResponse.next();
}

// IMPORTANT: exclude NextAuth and static assets
export const config = {
  matcher: [
    // run on everything EXCEPT these
    "/((?!api/auth|_next/static|_next/image|favicon.ico).*)",
  ],
};
