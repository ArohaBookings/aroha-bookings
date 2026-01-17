export type BrandingConfig = {
  logoUrl?: string;
  logoDarkUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  wordmark?: string;
};

const DEFAULT_PRIMARY = "#10B981";
const DEFAULT_WORDMARK = "Aroha Bookings";

function isHexColor(value?: string) {
  if (!value) return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

export function resolveBranding(data: Record<string, unknown>): BrandingConfig {
  const raw = (data.branding as BrandingConfig) || {};
  return {
    logoUrl: typeof raw.logoUrl === "string" && raw.logoUrl.trim() ? raw.logoUrl.trim() : undefined,
    logoDarkUrl:
      typeof raw.logoDarkUrl === "string" && raw.logoDarkUrl.trim()
        ? raw.logoDarkUrl.trim()
        : undefined,
    faviconUrl:
      typeof raw.faviconUrl === "string" && raw.faviconUrl.trim()
        ? raw.faviconUrl.trim()
        : undefined,
    primaryColor: isHexColor(raw.primaryColor) ? raw.primaryColor!.trim() : DEFAULT_PRIMARY,
    wordmark:
      typeof raw.wordmark === "string" && raw.wordmark.trim() ? raw.wordmark.trim() : DEFAULT_WORDMARK,
  };
}

export function brandPrimary(branding?: BrandingConfig | null) {
  return branding?.primaryColor || DEFAULT_PRIMARY;
}
