export function resolveOrigin(req: Request): string {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  }

  const envOrigin = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "").trim();
  if (envOrigin) return envOrigin.replace(/\/+$/, "");

  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return u.origin.replace(/\/+$/, "");
  } catch {
    // ignore
  }

  return "";
}
