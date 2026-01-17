// app/email-ai/page.tsx
import InboxClient from "./InboxClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default function EmailAIInboxPage() {
  return (
    <main className="p-0 md:p-6">
      <InboxClient />
    </main>
  );
}
