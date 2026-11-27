-- v3 redesign (README section 0). v2 tickets cannot be mapped to the new stage model, so
-- ticket data and the email outbox are emptied; old Managers become Staff.
TRUNCATE TABLE "comments", "ticket_activities", "tickets", "notifications" CASCADE;
UPDATE "memberships" SET "role" = 'STAFF' WHERE "role" = 'MANAGER';
UPDATE "invitations" SET "role" = 'STAFF' WHERE "role" = 'MANAGER';

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "LeaderTitle" AS ENUM ('HEAD', 'LEAD', 'MANAGER');

-- CreateEnum
CREATE TYPE "TicketKind" AS ENUM ('COMPLAINT', 'TASK');

-- CreateEnum
CREATE TYPE "TicketStage" AS ENUM ('PENDING_APPROVAL', 'AT_CATEGORY', 'AT_TEAM', 'ASSIGNED', 'IN_PROGRESS', 'TEAM_REVIEW', 'ADMIN_REVIEW', 'DONE', 'REJECTED');

-- AlterEnum
BEGIN;
CREATE TYPE "MembershipRole_new" AS ENUM ('ADMIN', 'STAFF');
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "MembershipRole_new" USING ("role"::text::"MembershipRole_new");
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "MembershipRole_new" USING ("role"::text::"MembershipRole_new");
ALTER TYPE "MembershipRole" RENAME TO "MembershipRole_old";
ALTER TYPE "MembershipRole_new" RENAME TO "MembershipRole";
DROP TYPE "public"."MembershipRole_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM ('NEEDS_APPROVAL', 'AT_CATEGORY', 'AT_TEAM', 'ASSIGNED_TO_YOU', 'NEEDS_TEAM_REVIEW', 'NEEDS_ADMIN_REVIEW', 'SENT_BACK', 'TICKET_DONE', 'CUSTOMER_DONE', 'CUSTOMER_REJECTED');
ALTER TABLE "notifications" ALTER COLUMN "type" TYPE "NotificationType_new" USING ("type"::text::"NotificationType_new");
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "public"."NotificationType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "categories" DROP CONSTRAINT "categories_defaultTeamId_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_parentId_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_requesterId_fkey";

-- DropIndex
DROP INDEX "tickets_organizationId_assigneeId_idx";

-- DropIndex
DROP INDEX "tickets_organizationId_parentId_idx";

-- DropIndex
DROP INDEX "tickets_organizationId_requesterId_idx";

-- DropIndex
DROP INDEX "tickets_organizationId_status_idx";

-- AlterTable
ALTER TABLE "categories" DROP COLUMN "defaultTeamId",
DROP COLUMN "isPublic",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "leadMembershipId" TEXT;

-- AlterTable
ALTER TABLE "comments" DROP COLUMN "authorType",
DROP COLUMN "visibility";

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "leaderTitle" "LeaderTitle",
ADD COLUMN     "teamId" TEXT,
ADD COLUMN     "teamRole" "TeamRole";

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "jobTitle" TEXT;

-- AlterTable
ALTER TABLE "team_members" DROP COLUMN "isLead",
ADD COLUMN     "leaderTitle" "LeaderTitle",
ADD COLUMN     "role" "TeamRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "ticket_activities" DROP COLUMN "type",
ADD COLUMN     "action" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "assigneeId",
DROP COLUMN "closeReason",
DROP COLUMN "closedAt",
DROP COLUMN "parentId",
DROP COLUMN "requesterId",
DROP COLUMN "resolvedAt",
DROP COLUMN "source",
DROP COLUMN "status",
ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "customerPhoneCode" TEXT,
ADD COLUMN     "finishedAt" TIMESTAMP(3),
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "kind" "TicketKind" NOT NULL,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stage" "TicketStage" NOT NULL,
ADD COLUMN     "trackingTokenHash" TEXT;

-- DropEnum
DROP TYPE "ActivityType";

-- DropEnum
DROP TYPE "CloseReason";

-- DropEnum
DROP TYPE "CommentAuthorType";

-- DropEnum
DROP TYPE "CommentVisibility";

-- DropEnum
DROP TYPE "TicketSource";

-- DropEnum
DROP TYPE "TicketStatus";

-- CreateTable
CREATE TABLE "ticket_assignees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "dueDate" DATE,
    "doneAt" TIMESTAMP(3),
    "doneByMembershipId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_assignees_membershipId_idx" ON "ticket_assignees"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignees_ticketId_membershipId_key" ON "ticket_assignees"("ticketId", "membershipId");

-- CreateIndex
CREATE INDEX "checklist_items_ticketId_position_idx" ON "checklist_items"("ticketId", "position");

-- CreateIndex
CREATE INDEX "teams_organizationId_categoryId_idx" ON "teams"("organizationId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_trackingTokenHash_key" ON "tickets"("trackingTokenHash");

-- CreateIndex
CREATE INDEX "tickets_organizationId_stage_idx" ON "tickets"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "tickets_organizationId_categoryId_idx" ON "tickets"("organizationId", "categoryId");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_leadMembershipId_fkey" FOREIGN KEY ("leadMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_assignees" ADD CONSTRAINT "ticket_assignees_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One Leader per team (README 0.2) and a title exactly when Leader.
CREATE UNIQUE INDEX "team_members_one_leader" ON "team_members"("teamId") WHERE "role" = 'LEADER';
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_leader_title" CHECK (("role" = 'LEADER') = ("leaderTitle" IS NOT NULL));
-- Complaints always carry the customer; progress is a percentage.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_complaint_customer" CHECK ("kind" <> 'COMPLAINT' OR ("customerName" IS NOT NULL AND "customerEmail" IS NOT NULL));
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_progress_range" CHECK ("progress" BETWEEN 0 AND 100);
