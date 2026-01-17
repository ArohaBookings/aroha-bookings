// lib/manage/token.ts
import { createHash, randomBytes } from "crypto";

/**
 * Stored server-side (never expose raw token)
 */
export type ManageTokenRecord = {
  hash: string;
  expiresAt: string;
  issuedAt: string;
};

export type ManageTokenPayload = {
  appointmentId: string;
  bookingIntentId: string;
};

/**
 * Input for issuing a manage token
 */
type IssueInput = {
  appointmentId: string;
  bookingIntentId: string;
};

/**
 * Issue a new opaque manage token and its server-side record.
 * The token itself contains NO data — all validation is done
 * via hash + expiry stored in OrgSettings / Appointment metadata.
 */
export function issueManageToken(
  input: IssueInput,
): {
  token: string;
  record: ManageTokenRecord;
} {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");

  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000, // 30 days
  );

  return {
    token,
    record: {
      hash,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Append / rotate manage token record inside OrgSettings.data
 */
export function appendManageToken(
  data: Record<string, unknown>,
  appointmentId: string,
  record: ManageTokenRecord,
): Record<string, unknown> {
  const next = { ...data };

  const map =
    (next.manageTokens as Record<string, ManageTokenRecord>) ?? {};

  map[appointmentId] = record;
  next.manageTokens = map;

  return next;
}

/**
 * Verify token *format only*.
 * Returns payload-like object for compatibility.
 *
 * NOTE:
 * - This does NOT check DB state.
 * - Hash + expiry validation happens in getManageContext().
 * - This function exists to stabilise imports + allow future extension.
 */
export function verifyManageToken(
  token: string,
): { appointmentId: string; bookingIntentId: string } | null {
  if (!token || typeof token !== "string") return null;
  if (token.length < 32) return null;

  // Opaque token — no embedded payload yet.
  // We return placeholders so callers can proceed safely.
  return {
    appointmentId: "",
    bookingIntentId: "",
  };
}
