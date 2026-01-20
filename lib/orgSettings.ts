// lib/orgSettings.ts
// Small helpers to keep OrgSettings.data schema stable and backwards compatible.

export type GoogleCalendarIntegration = {
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

export type GmailIntegration = {
  connected: boolean;
  accountEmail: string | null;
  lastError: string | null;
};

export type RetellCallsSettings = {
  agentId: string | null;
  phoneNumber: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
};

export type BookingToolsSettings = {
  enabled: boolean;
};

export type CallsSettings = {
  retell: RetellCallsSettings;
  bookingTools: BookingToolsSettings;
  voiceSecret: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readGoogleCalendarIntegration(data: Record<string, unknown>): GoogleCalendarIntegration {
  const integrations = asRecord(data.integrations);
  const google = asRecord(integrations.googleCalendar);

  const legacyCalendarId = toStringOrNull(data.googleCalendarId);
  const legacyAccountEmail = toStringOrNull(data.googleAccountEmail);
  const legacyLastSyncAt = toStringOrNull(data.calendarLastSyncAt);
  const legacyErrors = Array.isArray(data.calendarSyncErrors) ? data.calendarSyncErrors : [];
  const legacyLastError = legacyErrors.length
    ? toStringOrNull((legacyErrors[0] as Record<string, unknown>)?.error)
    : null;

  const calendarId = toStringOrNull(google.calendarId) ?? legacyCalendarId;
  const accountEmail = toStringOrNull(google.accountEmail) ?? legacyAccountEmail;
  const lastSyncAt = toStringOrNull(google.lastSyncAt) ?? legacyLastSyncAt;
  const lastSyncError = toStringOrNull(google.lastSyncError) ?? legacyLastError;
  const connected =
    typeof google.connected === "boolean" ? google.connected : Boolean(calendarId);
  const syncEnabled =
    typeof google.syncEnabled === "boolean" ? google.syncEnabled : true;

  return {
    connected,
    accountEmail,
    calendarId,
    syncEnabled,
    lastSyncAt,
    lastSyncError,
  };
}

export function writeGoogleCalendarIntegration(
  data: Record<string, unknown>,
  patch: Partial<GoogleCalendarIntegration>
): Record<string, unknown> {
  const next = { ...data };
  const integrations = asRecord(next.integrations);
  const google = { ...asRecord(integrations.googleCalendar), ...patch };
  integrations.googleCalendar = google;
  next.integrations = integrations;

  if ("calendarId" in patch) {
    if (patch.calendarId) next.googleCalendarId = patch.calendarId;
    else delete next.googleCalendarId;
  }
  if ("accountEmail" in patch) {
    if (patch.accountEmail) next.googleAccountEmail = patch.accountEmail;
    else delete next.googleAccountEmail;
  }
  if ("lastSyncAt" in patch) {
    if (patch.lastSyncAt) next.calendarLastSyncAt = patch.lastSyncAt;
    else delete next.calendarLastSyncAt;
  }

  return next;
}

export function readGmailIntegration(data: Record<string, unknown>): GmailIntegration {
  const integrations = asRecord(data.integrations);
  const gmail = asRecord(integrations.gmail);

  return {
    connected: typeof gmail.connected === "boolean" ? gmail.connected : false,
    accountEmail: toStringOrNull(gmail.accountEmail),
    lastError: toStringOrNull(gmail.lastError),
  };
}

export function writeGmailIntegration(
  data: Record<string, unknown>,
  patch: Partial<GmailIntegration>
): Record<string, unknown> {
  const next = { ...data };
  const integrations = asRecord(next.integrations);
  const gmail = { ...asRecord(integrations.gmail), ...patch };
  integrations.gmail = gmail;
  next.integrations = integrations;
  return next;
}

export function readCallsSettings(data: Record<string, unknown>): CallsSettings {
  const calls = asRecord(data.calls);
  const retell = asRecord(calls.retell);
  const bookingTools = asRecord(calls.bookingTools);

  return {
    retell: {
      agentId: toStringOrNull(retell.agentId),
      phoneNumber: toStringOrNull(retell.phoneNumber),
      webhookUrl: toStringOrNull(retell.webhookUrl),
      webhookSecret: toStringOrNull(retell.webhookSecret),
    },
    bookingTools: {
      enabled: typeof bookingTools.enabled === "boolean" ? bookingTools.enabled : false,
    },
    voiceSecret: toStringOrNull(calls.voiceSecret),
  };
}

export function writeCallsSettings(
  data: Record<string, unknown>,
  patch: Partial<CallsSettings>
): Record<string, unknown> {
  const next = { ...data };
  const calls = asRecord(next.calls);
  const retell = { ...asRecord(calls.retell), ...(patch.retell || {}) };
  const bookingTools = { ...asRecord(calls.bookingTools), ...(patch.bookingTools || {}) };

  calls.retell = retell;
  calls.bookingTools = bookingTools;
  if (patch.voiceSecret !== undefined) calls.voiceSecret = patch.voiceSecret;
  next.calls = calls;
  return next;
}

