-- Global settings singleton
CREATE TABLE "GlobalSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "globalZapierWebhookUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("id")
);

-- Forwarding jobs for webhooks
CREATE TABLE "WebhookForwardJob" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "orgId" TEXT NOT NULL,
  "retellCallId" TEXT NOT NULL,
  "destinationUrl" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebhookForwardJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebhookForwardJob_provider_retellCallId_destinationUrl_key"
  ON "WebhookForwardJob"("provider", "retellCallId", "destinationUrl");
CREATE INDEX "WebhookForwardJob_status_nextAttemptAt_idx"
  ON "WebhookForwardJob"("status", "nextAttemptAt");
CREATE INDEX "WebhookForwardJob_orgId_idx"
  ON "WebhookForwardJob"("orgId");

ALTER TABLE "WebhookForwardJob"
  ADD CONSTRAINT "WebhookForwardJob_orgId_fkey"
  FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
