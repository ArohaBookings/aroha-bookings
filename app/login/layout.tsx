// app/login/layout.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const dynamicParams = true;

import React from "react";

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
