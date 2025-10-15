// middleware.ts  (project root)
export { default } from "next-auth/middleware";

// Protect only signed-in areas; leave marketing, register, API, webhooks public.
export const config = {
  matcher: [
    "/dashboard",
    "/calendar",
    "/clients",
    "/settings",
    "/o/:path*",
  ],
};
