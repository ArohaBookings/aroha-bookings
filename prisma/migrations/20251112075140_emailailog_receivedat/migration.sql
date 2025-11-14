/*
  EmailAILog harden:
  - add receivedAt
  - backfill from rawMeta.emailEpochMs or createdAt
  - remove dupes per (orgId, gmailMsgId)
  - add indexes and unique constraint
*/

-- 1) Column
ALTER TABLE "EmailAILog" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);

-- 2) Backfill receivedAt from rawMeta.emailEpochMs (ms) or createdAt
UPDATE "EmailAILog"
SET "receivedAt" = COALESCE(
  CASE
    WHEN ("rawMeta" ? 'emailEpochMs')
         AND NULLIF(("rawMeta"->>'emailEpochMs')::bigint, 0) IS NOT NULL
    THEN to_timestamp( (("rawMeta"->>'emailEpochMs')::bigint) / 1000.0 )
    ELSE NULL
  END,
  "createdAt"
)
WHERE "receivedAt" IS NULL;

-- 3) Drop older duplicates so unique index can be created
WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY "orgId","gmailMsgId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS rn
  FROM "EmailAILog"
  WHERE "gmailMsgId" IS NOT NULL
)
DELETE FROM "EmailAILog" e
USING ranked r
WHERE e.ctid = r.ctid
  AND r.rn > 1;

-- 4) Indexes
CREATE INDEX IF NOT EXISTS "EmailAILog_orgId_receivedAt_idx"
  ON "EmailAILog"("orgId","receivedAt");

CREATE INDEX IF NOT EXISTS "EmailAILog_orgId_action_receivedAt_idx"
  ON "EmailAILog"("orgId","action","receivedAt");

-- 5) Unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "EmailAILog_orgId_gmailMsgId_key"
  ON "EmailAILog"("orgId","gmailMsgId");
