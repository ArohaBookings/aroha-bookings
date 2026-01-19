export type DemoMessage = {
  id: string;
  channel: "instagram" | "whatsapp" | "sms";
  fromName: string;
  fromHandle: string;
  preview: string;
  body: string;
  receivedAt: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  risk: "safe" | "needs_review" | "blocked";
  confidence: number;
  status: "new" | "draft_ready" | "needs_review" | "sent";
  draft?: string | null;
  usedSnippets?: string[];
  quickActions?: string[];
};

export const DEMO_MESSAGES: DemoMessage[] = [
  {
    id: "msg_101",
    channel: "instagram",
    fromName: "Mia Thompson",
    fromHandle: "@miathompson",
    preview: "Can I book a keratin treatment this Friday afternoon?",
    body: "Hey! Can I book a keratin treatment this Friday afternoon? I’m free after 3pm.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    category: "booking_request",
    priority: "high",
    risk: "safe",
    confidence: 96,
    status: "draft_ready",
    draft:
      "Hi Mia! We can do Friday after 3pm. I’ve got 3:30pm or 4:30pm available — which works best? You can also book directly here: /book/demo.",
    usedSnippets: ["Availability", "Booking link"],
    quickActions: ["Hold slot", "Send booking link"],
  },
  {
    id: "msg_102",
    channel: "whatsapp",
    fromName: "Ryan Patel",
    fromHandle: "+64 21 555 019",
    preview: "Do you have a price list for cosmetic injectables?",
    body: "Hi! Do you have a price list for cosmetic injectables? Also how long does it take?",
    receivedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    category: "pricing",
    priority: "normal",
    risk: "needs_review",
    confidence: 88,
    status: "needs_review",
    draft:
      "Thanks for reaching out, Ryan. We can send you our pricing and talk through the best option — would you like the price list by email?",
    usedSnippets: ["Pricing policy"],
    quickActions: ["Request email", "Send booking link"],
  },
  {
    id: "msg_103",
    channel: "sms",
    fromName: "Jess Nguyen",
    fromHandle: "+64 27 884 771",
    preview: "Running late for 2pm, can we push 30 mins?",
    body: "Hey, I’m running late for 2pm. Can we push 30 mins?",
    receivedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    category: "reschedule",
    priority: "urgent",
    risk: "safe",
    confidence: 93,
    status: "draft_ready",
    draft:
      "No worries, Jess — I can move you to 2:30pm. Please reply YES to confirm and we’ll hold it.",
    usedSnippets: ["Reschedule policy"],
    quickActions: ["Hold slot", "Confirm reschedule"],
  },
  {
    id: "msg_104",
    channel: "instagram",
    fromName: "Aroha Review",
    fromHandle: "@arohareview",
    preview: "I’m really unhappy with the last visit...",
    body: "I’m really unhappy with the last visit and want to complain about the result.",
    receivedAt: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    category: "complaint",
    priority: "urgent",
    risk: "blocked",
    confidence: 97,
    status: "needs_review",
    draft: null,
    usedSnippets: [],
    quickActions: ["Escalate to manager"],
  },
  {
    id: "msg_105",
    channel: "whatsapp",
    fromName: "Leo Carter",
    fromHandle: "+64 21 444 882",
    preview: "What’s your address and parking?",
    body: "Hi there! What’s your address and is there parking nearby?",
    receivedAt: new Date(Date.now() - 1000 * 60 * 240).toISOString(),
    category: "faq",
    priority: "low",
    risk: "safe",
    confidence: 94,
    status: "draft_ready",
    draft:
      "We’re at 22 Ponsonby Rd, Auckland. There’s 30-min parking out front and a paid lot across the street.",
    usedSnippets: ["Location", "Parking"],
    quickActions: ["Send map link", "Send booking link"],
  },
];
