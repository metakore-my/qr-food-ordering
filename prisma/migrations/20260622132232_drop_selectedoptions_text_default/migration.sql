-- AlterTable
ALTER TABLE `cart_items` ALTER COLUMN `selectedOptions` DROP DEFAULT;

-- AlterTable
ALTER TABLE `order_items` ALTER COLUMN `selectedOptions` DROP DEFAULT;
