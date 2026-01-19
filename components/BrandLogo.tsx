// FILE MAP: app layout at app/layout.tsx; Retell webhook at app/api/webhooks/voice/[provider]/[orgId]/route.ts.
"use client";

import React from "react";
import type { BrandingConfig } from "@/lib/branding";

type Props = {
  branding?: BrandingConfig | null;
  size?: number;
  showWordmark?: boolean;
  chrome?: "header" | "sidebar" | "collapsed";
  mode?: "mark" | "full";
  variant?: "light" | "dark" | "auto";
  preferLocal?: boolean;
  priority?: "chrome" | "default";
  className?: string;
  wordmarkClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  showWordmarkText?: boolean;

  /**
   * If true, BrandLogo will try local public assets:
   * /brand/aroha-bookings.png (dark/normal)
   * /brand/aroha-bookings-white.png (light)
   */
  useLocalFallbacks?: boolean;
  useLocalFallbackAssets?: boolean;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function BrandLogo({
  branding,
  size = 40,
  showWordmark = true,
  mode,
  variant = "auto",
  preferLocal = true,
  priority = "default",
  className,
  wordmarkClassName,
  titleClassName,
  subtitleClassName,
  showWordmarkText = true,
  chrome,
}: Props) {
  const [imgFailed, setImgFailed] = React.useState(false);

  const resolvedVariant = variant === "auto" ? "dark" : variant;
  const resolvedMode = mode ?? (showWordmark ? "full" : "mark");

  const wordmark = branding?.wordmark || "Aroha Bookings";
  const resolvedHeight =
    chrome === "header"
      ? 56
      : chrome === "collapsed"
      ? 36
      : chrome === "sidebar"
      ? 56
      : size;

  // 1) Highest priority: org-configured URL (from DB)
  const remoteLogoUrl =
    resolvedVariant === "dark"
      ? branding?.logoDarkUrl || branding?.logoUrl
      : branding?.logoUrl;

  const localPng = "/brand/aroha-bookings.png";
  const candidateSrc = remoteLogoUrl || (preferLocal ? localPng : "");
  const shouldShowImg = Boolean(candidateSrc) && !imgFailed;

  React.useEffect(() => {
    setImgFailed(false);
  }, [candidateSrc]);

  return (
    <div className={cn("flex items-center gap-3", className)} aria-label={wordmark}>
      {shouldShowImg ? (
        <img
          src={candidateSrc}
          alt={`${wordmark} logo`}
          className="object-contain"
          style={{ height: resolvedHeight, width: "auto" }}
          onError={() => {
            setImgFailed(true);
          }}
        />
      ) : (
        <span
          className="inline-flex items-center justify-center rounded-2xl bg-emerald-500 text-zinc-950 font-black shadow-sm shadow-emerald-500/30"
          style={{ width: size, height: size }}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden>
            <path d="m12 3 7 18h-3.4l-1.4-3.7H9.8L8.4 21H5L12 3Zm0 6-1.6 4.3h3.2L12 9Z" />
          </svg>
        </span>
      )}

      {resolvedMode === "full" && showWordmarkText ? (
        <div className={cn("leading-tight", wordmarkClassName)}>
          <div className={cn("text-sm font-semibold tracking-tight text-zinc-900", titleClassName)}>
            {wordmark}
          </div>
          <div className={cn("text-[11px] text-zinc-500", subtitleClassName)}>
            Premium scheduling
          </div>
        </div>
      ) : null}
    </div>
  );
}
