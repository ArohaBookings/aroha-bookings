// app/email-ai/run-poll/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PollRunnerPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/email-ai");
  }, [router]);

  return <div className="p-6 text-sm text-zinc-600">Redirecting to the live inbox…</div>;
}
