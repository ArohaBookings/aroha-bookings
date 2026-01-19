-- Add summary job status lock for call summaries
ALTER TABLE "CallLog" ADD COLUMN "summaryJobStatus" TEXT;
