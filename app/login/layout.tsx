// app/login/layout.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const dynamicParams = true;

import React from "react";

/**
 * DO NOT wrap with <html>/<body> here — the root layout does that
 * and also renders your global header. This layout just provides
 * a centered container for the login page content.
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-[calc(100vh-56px)] w-full bg-gray-50">
      {/* The header from the ROOT layout stays at the top.
          This container simply centers the login card. */}
      <div className="mx-auto max-w-7xl px-4">
        <div className="min-h-[70vh] grid place-items-center py-10">{children}</div>
      </div>
    </div>
  );
}
