"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";

export default function LogoutPage() {
  useEffect(() => {
    // sign out and send them to /login
    signOut({ callbackUrl: "/login" });
  }, []);

  return (
    <main className="max-w-sm mx-auto mt-20 text-center">
      <p className="text-sm text-zinc-700">Signing you out…</p>
    </main>
  );
}
