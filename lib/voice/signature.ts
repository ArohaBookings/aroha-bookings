// lib/voice/signature.ts
import { createHmac, timingSafeEqual } from "crypto";

export function parseSignatureHeader(header: string | null): { signatures: string[]; timestamp: string | null } {
  if (!header) return { signatures: [], timestamp: null };
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  const signatures: string[] = [];
  let timestamp: string | null = null;
  if (parts.length === 0) return { signatures, timestamp };
  for (const part of parts) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (!v) {
      signatures.push(part);
      continue;
    }
    if (k === "t") timestamp = v;
    if (k === "v1" || k === "sig" || k === "signature") signatures.push(v);
  }
  if (signatures.length === 0) signatures.push(header.trim());
  return { signatures, timestamp };
}

export function safeCompare(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  tsHeader: string | null,
  maxSkewMs = 5 * 60_000
) {
  if (!signatureHeader || !secret) return false;
  const { signatures, timestamp } = parseSignatureHeader(signatureHeader);
  const now = Date.now();
  const ts = timestamp || tsHeader;
  if (ts) {
    const tsMs = Number(ts) * 1000;
    if (!Number.isNaN(tsMs) && Math.abs(now - tsMs) > maxSkewMs) return false;
  }

  const hmac = (input: string, encoding: "hex" | "base64") =>
    createHmac("sha256", secret).update(input).digest(encoding);
  const expectedHex = hmac(rawBody, "hex");
  const expectedBase64 = hmac(rawBody, "base64");

  return signatures.some((sig) => safeCompare(sig, expectedHex) || safeCompare(sig, expectedBase64));
}

