import { google } from "googleapis";

type GoogleAuthOptions = {
  scopes: string[];
  state: string;
  prompt?: "consent" | "select_account";
  accessType?: "offline" | "online";
};

export function getGoogleOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUrl = process.env.GOOGLE_REDIRECT_URL || "";
  if (!clientId || !clientSecret || !redirectUrl) {
    throw new Error("Google OAuth env vars missing");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUrl);
}

export function buildGoogleAuthUrl(options: GoogleAuthOptions) {
  const oauth2 = getGoogleOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: options.accessType ?? "offline",
    prompt: options.prompt ?? "consent",
    scope: options.scopes,
    state: options.state,
  });
}
