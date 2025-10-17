/*
  Warnings:

  - A unique constraint covering the columns `[orgId,provider,accountEmail]` on the table `CalendarConnection` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[orgId,weekday]` on the table `OpeningHours` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[orgId,name]` on the table `Service` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[orgId,name]` on the table `StaffMember` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[orgId,email]` on the table `StaffMember` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[staffId,dayOfWeek]` on the table `StaffSchedule` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "public"."OpeningHours_orgId_weekday_idx";

-- DropIndex
DROP INDEX "public"."StaffMember_email_key";

-- DropIndex
DROP INDEX "public"."StaffSchedule_staffId_dayOfWeek_idx";

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_orgId_provider_accountEmail_key" ON "CalendarConnection"("orgId", "provider", "accountEmail");

-- CreateIndex
CREATE INDEX "Customer_orgId_email_idx" ON "Customer"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningHours_orgId_weekday_key" ON "OpeningHours"("orgId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "Service_orgId_name_key" ON "Service"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_orgId_name_key" ON "StaffMember"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_orgId_email_key" ON "StaffMember"("orgId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSchedule_staffId_dayOfWeek_key" ON "StaffSchedule"("staffId", "dayOfWeek");
