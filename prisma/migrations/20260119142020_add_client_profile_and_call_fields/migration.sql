-- CreateEnum
CREATE TYPE "TonePreference" AS ENUM ('DEFAULT', 'FORMAL', 'CASUAL');

-- AlterTable
ALTER TABLE "CallLog" ADD COLUMN     "businessPhone" TEXT,
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'INBOUND',
ADD COLUMN     "retellCallId" TEXT,
ADD COLUMN     "summaryAi" TEXT,
ADD COLUMN     "summarySystem" TEXT,
ADD COLUMN     "summaryUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "preferredDays" JSONB,
    "preferredTimes" JSONB,
    "lastServiceId" TEXT,
    "tonePreference" "TonePreference" NOT NULL DEFAULT 'DEFAULT',
    "notes" TEXT,
    "cancellationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_customerId_key" ON "ClientProfile"("customerId");

-- CreateIndex
CREATE INDEX "ClientProfile_orgId_idx" ON "ClientProfile"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_orgId_customerId_key" ON "ClientProfile"("orgId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_retellCallId_key" ON "CallLog"("retellCallId");

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

