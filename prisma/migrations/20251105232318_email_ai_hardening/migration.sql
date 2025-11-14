/*
  Warnings:

  - You are about to alter the column `startTime` on the `StaffSchedule` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(5)`.
  - You are about to alter the column `endTime` on the `StaffSchedule` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(5)`.

*/
-- DropIndex
DROP INDEX "public"."Service_orgId_name_idx";

-- AlterTable
ALTER TABLE "StaffSchedule" ALTER COLUMN "startTime" SET DATA TYPE VARCHAR(5),
ALTER COLUMN "endTime" SET DATA TYPE VARCHAR(5);

-- CreateTable
CREATE TABLE "EmailAISettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "googleAccountEmail" TEXT,
    "signature" TEXT,
    "businessName" TEXT NOT NULL DEFAULT 'Your business',
    "businessHoursTz" TEXT NOT NULL DEFAULT 'Pacific/Auckland',
    "businessHoursJson" JSONB NOT NULL DEFAULT '{}',
    "defaultTone" TEXT NOT NULL DEFAULT 'friendly, concise, local',
    "instructionPrompt" TEXT NOT NULL,
    "allowedSendersRegex" TEXT,
    "blockedSendersRegex" TEXT,
    "autoReplyRulesJson" JSONB NOT NULL DEFAULT '[]',
    "minConfidenceToSend" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
    "humanEscalationTags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAISettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAILog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "gmailMsgId" TEXT,
    "direction" TEXT NOT NULL,
    "classification" TEXT,
    "confidence" DOUBLE PRECISION,
    "subject" TEXT,
    "snippet" TEXT,
    "action" TEXT,
    "reason" TEXT,
    "rawMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAILog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailAISettings_orgId_key" ON "EmailAISettings"("orgId");

-- CreateIndex
CREATE INDEX "EmailAILog_orgId_createdAt_idx" ON "EmailAILog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAILog_gmailThreadId_idx" ON "EmailAILog"("gmailThreadId");

-- CreateIndex
CREATE INDEX "Appointment_orgId_endsAt_idx" ON "Appointment"("orgId", "endsAt");

-- AddForeignKey
ALTER TABLE "EmailAISettings" ADD CONSTRAINT "EmailAISettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAILog" ADD CONSTRAINT "EmailAILog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
