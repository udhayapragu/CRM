/*
  Warnings:

  - You are about to drop the column `reversalOfId` on the `Commission` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Commission" DROP CONSTRAINT "Commission_reversalOfId_fkey";

-- DropIndex
DROP INDEX "Commission_reversalOfId_key";

-- AlterTable
ALTER TABLE "Commission" DROP COLUMN "reversalOfId",
ADD COLUMN     "adjustsId" TEXT;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_adjustsId_fkey" FOREIGN KEY ("adjustsId") REFERENCES "Commission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
