import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type JobStatus = "PENDING" | "FAILED" | "SENT" | "PROCESSING";
type ForwardJob = {
  id: string;
  orgId: string;
  retellCallId: string;
  destinationUrl: string;
  payload: Prisma.InputJsonValue;
  status: JobStatus;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  createdAt: Date;
  updatedAt?: Date;
};

function nextAttempt(attemptCount: number) {
  // Exponential backoff with jitter, capped at 30 minutes
  const baseMs = 30_000;
  const maxMs = 30 * 60_000;

  const exp = baseMs * Math.pow(2, Math.max(0, attemptCount));
  const jitter = 0.2; // 20%
  const withJitter = exp * (1 - jitter + Math.random() * (2 * jitter));

  const delay = Math.min(maxMs, withJitter);
  return new Date(Date.now() + delay);
}

function safeError(err: unknown) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * TS2339 fix:
 * If prisma client hasn't been regenerated (or migrations not applied),
 * prisma.webhookForwardJob won't exist at type-level.
 * This keeps runtime working while still encouraging proper schema sync.
 */
function getForwardJobDelegate() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prisma as any;
  const delegate = p.webhookForwardJob;
  if (!delegate) {
    throw new Error(
      "Prisma model webhookForwardJob is missing on the generated client. " +
        "Run: npx prisma migrate dev (or deploy) && npx prisma generate"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return delegate as any;
}

/**
 * Processes webhook forward jobs reliably.
 * - Pulls due jobs (PENDING/FAILED)
 * - Acquires a lightweight lock to avoid double-processing
 * - POSTs to destination with timeout + error capture
 * - Retries with exponential backoff + jitter
 */
export async function processForwardQueue(opts?: {
  limit?: number;
  timeoutMs?: number;
  lockTtlMs?: number;
  workerId?: string;
}) {
  const limit = opts?.limit ?? 50;
  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const lockTtlMs = opts?.lockTtlMs ?? 60_000; // consider job "stuck" after 60s
  const workerId = opts?.workerId ?? `worker_${process.pid}_${Math.random().toString(16).slice(2)}`;

  const now = new Date();
  const staleLockBefore = new Date(Date.now() - lockTtlMs);

  const forwardJob = getForwardJobDelegate();

  // 1) Fetch due jobs (best-effort ordering)
  const jobs: ForwardJob[] = await forwardJob.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      // If you have locking fields, ignore actively locked jobs unless stale:
      // OR: [{ lockedAt: null }, { lockedAt: { lte: staleLockBefore } }],
    },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  let processed = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    processed += 1;

    // 2) Acquire lock (if schema supports it) — safe even if fields don't exist at runtime? No.
    // So we do a conditional lock attempt that won't crash TS, and runtime will work if columns exist.
    let locked = false;
    try {
      const updated = await forwardJob.updateMany({
        where: {
          id: job.id,
          status: { in: ["PENDING", "FAILED"] },
          // Lock rules: either unlocked, or stale
          OR: [{ lockedAt: null }, { lockedAt: { lte: staleLockBefore } }],
        },
        data: {
          status: "PROCESSING",
          lockedAt: new Date(),
          lockedBy: workerId,
          attemptCount: job.attemptCount, // do not increment yet
        },
      });

      locked = (updated?.count ?? 0) > 0;
    } catch {
      // If your table doesn't have lockedAt/lockedBy/PROCESSING yet, we just proceed without lock.
      locked = true;
    }

    if (!locked) {
      skipped += 1;
      continue;
    }

    // 3) Send request with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(job.destinationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Idempotency hints (Zapier ignores, but useful for your own endpoints)
          "X-Aroha-Forward-Job-Id": job.id,
          "X-Aroha-Org-Id": job.orgId,
          "X-Aroha-Retell-Call-Id": job.retellCallId,
        },
        body: JSON.stringify(job.payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Destination ${res.status} ${res.statusText}${body ? ` · ${body.slice(0, 300)}` : ""}`);
      }

      await forwardJob.update({
        where: { id: job.id },
        data: {
          status: "SENT",
          attemptCount: job.attemptCount + 1,
          nextAttemptAt: null,
          lastError: null,
          lockedAt: null,
          lockedBy: null,
        },
      });

      sent += 1;
    } catch (err: unknown) {
      const msg = safeError(err);

      await forwardJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          attemptCount: job.attemptCount + 1,
          nextAttemptAt: nextAttempt(job.attemptCount + 1),
          lastError: msg,
          lockedAt: null,
          lockedBy: null,
        },
      });

      failed += 1;
    } finally {
      clearTimeout(timer);
    }
  }

  return { processed, sent, failed, skipped };
}
