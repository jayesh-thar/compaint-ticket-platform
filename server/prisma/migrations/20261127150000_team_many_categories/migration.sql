-- A team can now be in several categories (D-31). Existing links are kept.

-- CreateTable
CREATE TABLE "_CategoryToTeam" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_CategoryToTeam_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_CategoryToTeam_B_index" ON "_CategoryToTeam"("B");

-- AddForeignKey
ALTER TABLE "_CategoryToTeam" ADD CONSTRAINT "_CategoryToTeam_A_fkey" FOREIGN KEY ("A") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToTeam" ADD CONSTRAINT "_CategoryToTeam_B_fkey" FOREIGN KEY ("B") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Copy the old one-category links (A = category, B = team).
INSERT INTO "_CategoryToTeam" ("A", "B")
SELECT "categoryId", "id" FROM "teams" WHERE "categoryId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "teams" DROP CONSTRAINT "teams_categoryId_fkey";

-- DropIndex
DROP INDEX "teams_organizationId_categoryId_idx";

-- AlterTable
ALTER TABLE "teams" DROP COLUMN "categoryId";
