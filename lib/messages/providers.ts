export type ProviderStatus = "not_configured" | "setup_required" | "connected";

export type ProviderCapabilities = {
  canRead: boolean;
  canSend: boolean;
  canDraft: boolean;
};

export type MessageProvider = {
  id: "instagram" | "whatsapp" | "sms";
  label: string;
  status: ProviderStatus;
  capabilities: ProviderCapabilities;
  summary: string;
};

export function stubProviders(): MessageProvider[] {
  return [
    {
      id: "instagram",
      label: "Instagram DMs",
      status: "setup_required",
      capabilities: { canRead: true, canSend: false, canDraft: true },
      summary: "Drafts ready, sending gated until the official connector is enabled.",
    },
    {
      id: "whatsapp",
      label: "WhatsApp Business",
      status: "setup_required",
      capabilities: { canRead: true, canSend: false, canDraft: true },
      summary: "Drafts ready, send approval required.",
    },
    {
      id: "sms",
      label: "SMS (Placeholder)",
      status: "not_configured",
      capabilities: { canRead: false, canSend: false, canDraft: true },
      summary: "Enable SMS after messaging gateway setup.",
    },
  ];
}
