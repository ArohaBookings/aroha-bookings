-- CreateEnum
CREATE TYPE "Niche" AS ENUM ('HAIR_BEAUTY', 'TRADES', 'DENTAL', 'LAW', 'AUTO', 'MEDICAL');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "externalCalendarEventId" TEXT,
ADD COLUMN     "externalCalendarId" TEXT,
ADD COLUMN     "externalProvider" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "niche" "Niche";
