"use client";

import React from "react";
import type { BrandingConfig } from "@/lib/branding";

type Props = {
  branding?: BrandingConfig | null;
  size?: number;
  showWordmark?: boolean;
  variant?: "light" | "dark";
  className?: string;
  wordmarkClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function BrandLogo({
  branding,
  size = 40,
  showWordmark = true,
  variant = "light",
  className,
  wordmarkClassName,
  titleClassName,
  subtitleClassName,
}: Props) {
  const [showFallback, setShowFallback] = React.useState(false);
  const logoUrl = variant === "dark" ? branding?.logoDarkUrl || branding?.logoUrl : branding?.logoUrl;
  const wordmark = branding?.wordmark || "Aroha Bookings";
  const fullFallback = variant === "dark" ? "/branding/logo-full-light.svg" : "/branding/logo-full-dark.svg";
  const markFallback = "/branding/logo.svg";
  const resolvedLogo = logoUrl || (showWordmark ? fullFallback : markFallback);
  const resolvedWidth = showWordmark ? Math.round(size * 3.2) : size;
  const showText = showWordmark && Boolean(logoUrl);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {resolvedLogo && !showFallback ? (
        <img
          src={resolvedLogo}
          alt={`${wordmark} logo`}
          className="rounded-xl object-contain"
          style={{ width: resolvedWidth, height: size }}
          onError={() => setShowFallback(true)}
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
      {showText ? (
        <div className={cn("leading-tight", wordmarkClassName)}>
          <div className={cn("text-sm font-semibold tracking-tight text-zinc-900", titleClassName)}>
            {wordmark}
          </div>
          <div className={cn("text-[11px] text-zinc-500", subtitleClassName)}>Premium scheduling</div>
        </div>
      ) : null}
    </div>
  );
}
