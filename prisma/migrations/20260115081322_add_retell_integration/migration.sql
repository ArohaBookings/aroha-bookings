-- CreateEnum
CREATE TYPE "CallOutcome" AS ENUM ('COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RetellConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetellConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "callerPhone" TEXT NOT NULL,
    "transcript" TEXT,
    "recordingUrl" TEXT,
    "outcome" "CallOutcome" NOT NULL,
    "appointmentId" TEXT,
    "rawJson" JSONB NOT NULL,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetellConnection_orgId_active_idx" ON "RetellConnection"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RetellConnection_orgId_agentId_key" ON "RetellConnection"("orgId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_callId_key" ON "CallLog"("callId");

-- CreateIndex
CREATE INDEX "CallLog_orgId_agentId_startedAt_idx" ON "CallLog"("orgId", "agentId", "startedAt");

-- CreateIndex
CREATE INDEX "CallLog_orgId_outcome_idx" ON "CallLog"("orgId", "outcome");

-- CreateIndex
CREATE INDEX "CallLog_appointmentId_idx" ON "CallLog"("appointmentId");

-- AddForeignKey
ALTER TABLE "RetellConnection" ADD CONSTRAINT "RetellConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
