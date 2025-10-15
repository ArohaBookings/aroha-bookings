// app/logout/page.tsx
"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function LogoutPage() {
  useEffect(() => {
    // Redirect after sign out; no "sorry we couldn't" messages.
    signOut({ callbackUrl: "/login", redirect: true });
  }, []);

  return (
    <main className="max-w-sm mx-auto mt-20 text-center">
      <p className="text-sm text-zinc-700">Signing you out…</p>
    </main>
  );
}
