import MessagesClient from "./MessagesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MessagesPage() {
  return <MessagesClient />;
}
