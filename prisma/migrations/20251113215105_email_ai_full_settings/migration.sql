-- AlterTable
ALTER TABLE "EmailAISettings" ADD COLUMN     "autoSendAboveConfidence" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "knowledgeBaseJson" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "logRetentionDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "model" TEXT NOT NULL DEFAULT 'gpt-5-mini',
ALTER COLUMN "instructionPrompt" SET DEFAULT '';
