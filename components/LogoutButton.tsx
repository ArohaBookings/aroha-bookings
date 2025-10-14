"use client";
import { signOut } from "next-auth/react";

export function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="border border-black px-3 py-2 rounded hover:bg-black hover:text-white transition"
    >
      Log out
    </button>
  );
}
