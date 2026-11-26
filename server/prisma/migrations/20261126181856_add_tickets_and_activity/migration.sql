-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "source" "TicketSource" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
    "closeReason" "CloseReason",
    "closeNote" TEXT,
    "categoryId" TEXT,
    "teamId" TEXT,
    "assigneeId" TEXT,
    "requesterId" TEXT,
    "createdByMembershipId" TEXT,
    "parentId" TEXT,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "ActivityType" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tickets_organizationId_status_idx" ON "tickets"("organizationId", "status");

-- CreateIndex
CREATE INDEX "tickets_organizationId_assigneeId_idx" ON "tickets"("organizationId", "assigneeId");

-- CreateIndex
CREATE INDEX "tickets_organizationId_teamId_idx" ON "tickets"("organizationId", "teamId");

-- CreateIndex
CREATE INDEX "tickets_organizationId_requesterId_idx" ON "tickets"("organizationId", "requesterId");

-- CreateIndex
CREATE INDEX "tickets_organizationId_parentId_idx" ON "tickets"("organizationId", "parentId");

-- CreateIndex
CREATE INDEX "tickets_organizationId_updatedAt_idx" ON "tickets"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_organizationId_number_key" ON "tickets"("organizationId", "number");

-- CreateIndex
CREATE INDEX "ticket_activities_ticketId_createdAt_idx" ON "ticket_activities"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_createdByMembershipId_fkey" FOREIGN KEY ("createdByMembershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_activities" ADD CONSTRAINT "ticket_activities_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_activities" ADD CONSTRAINT "ticket_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Business rules the database enforces itself (architecture section 8).
-- Portal complaints always have a requester.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_portal_has_requester"
  CHECK ("source" <> 'PORTAL' OR "requesterId" IS NOT NULL);
-- Sub-tickets are internal work items: never a requester.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subticket_no_requester"
  CHECK ("parentId" IS NULL OR "requesterId" IS NULL);
-- A close reason exists exactly when the ticket is CLOSED.
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_close_reason_iff_closed"
  CHECK (("status" = 'CLOSED') = ("closeReason" IS NOT NULL));
