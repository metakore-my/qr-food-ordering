-- DropForeignKey
ALTER TABLE `sessions` DROP FOREIGN KEY `sessions_tableId_fkey`;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `customerName` VARCHAR(100) NULL,
    ADD COLUMN `orderType` ENUM('DINE_IN', 'TAKEAWAY') NOT NULL DEFAULT 'DINE_IN';

-- AlterTable
ALTER TABLE `sessions` MODIFY `tableId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
