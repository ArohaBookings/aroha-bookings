import { google } from "googleapis";

type GoogleAuthOptions = {
  scopes: string[];
  state: string;
  prompt?: "consent" | "select_account";
  accessType?: "offline" | "online";
  redirectUrl?: string;
};

function resolveRedirectUrl(override?: string) {
  if (override && override.trim()) return override.trim();
  const envOrigin = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").trim();
  if (envOrigin) return `${envOrigin.replace(/\/+$/, "")}/api/integrations/google/callback`;
  throw new Error("Google OAuth redirect URL missing (set NEXT_PUBLIC_APP_URL or NEXTAUTH_URL)");
}

export function getGoogleOAuthClient(redirectUrl?: string) {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth env vars missing (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
  }
  const finalRedirect = resolveRedirectUrl(redirectUrl);
  return new google.auth.OAuth2(clientId, clientSecret, finalRedirect);
}

export function buildGoogleAuthUrl(options: GoogleAuthOptions) {
  const oauth2 = getGoogleOAuthClient(options.redirectUrl);
  return oauth2.generateAuthUrl({
    access_type: options.accessType ?? "offline",
    prompt: options.prompt ?? "consent",
    scope: options.scopes,
    state: options.state,
  });
}
