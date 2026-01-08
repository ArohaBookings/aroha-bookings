// app/support/resend-setup/page.tsx
import type { Metadata } from "next";
import ResendSetupForm from "./ResendSetupForm";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Resend Setup Link • Aroha Bookings",
  description:
    "Resend your Aroha Bookings setup link using the email address you used at checkout.",
};

export default function ResendSetupPage() {
  return (
    <div className="p-8 max-w-xl mx-auto text-zinc-900">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">
        Resend your setup link
      </h1>
      <p className="text-sm text-zinc-600 mb-6">
        Enter the email you used at checkout and we&apos;ll send you a fresh
        Aroha Bookings setup link.
      </p>

      <ResendSetupForm />

      <p className="mt-6 text-xs text-zinc-500">
        If you don&apos;t receive anything in a few minutes, check your spam
        folder or contact{" "}
        <a
          href="mailto:support@arohacalls.com"
          className="text-indigo-600 underline"
        >
          support@arohacalls.com
        </a>
        .
      </p>
    </div>
  );
}
