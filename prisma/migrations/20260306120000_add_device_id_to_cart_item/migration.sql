-- AlterTable: add deviceId column to cart_items
-- Default to 'legacy' for existing rows, then require non-null going forward
ALTER TABLE `cart_items` ADD COLUMN `deviceId` VARCHAR(36) NOT NULL DEFAULT 'legacy';

-- Remove the default after backfilling existing rows
ALTER TABLE `cart_items` ALTER COLUMN `deviceId` DROP DEFAULT;

-- CreateIndex for per-device cart queries
CREATE INDEX `cart_items_sessionId_deviceId_idx` ON `cart_items`(`sessionId`, `deviceId`);
