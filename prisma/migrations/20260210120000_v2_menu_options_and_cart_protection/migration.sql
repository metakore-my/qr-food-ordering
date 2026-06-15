-- V2: Menu options system + cart/order protection
-- Combines: menu options tables, selectedOptions columns, nullable OrderItem.menuItemId, CartItem cascade delete

-- ============================================
-- 1. Create menu options tables
-- ============================================

CREATE TABLE `option_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `menuItemId` INTEGER NOT NULL,
    `selectionType` ENUM('SINGLE', 'MULTIPLE') NOT NULL DEFAULT 'SINGLE',
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `option_groups_menuItemId_idx`(`menuItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `option_group_translations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `optionGroupId` INTEGER NOT NULL,
    `locale` VARCHAR(5) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `option_group_translations_optionGroupId_locale_key`(`optionGroupId`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `option_choices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `optionGroupId` INTEGER NOT NULL,
    `priceAdjustment` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `option_choices_optionGroupId_idx`(`optionGroupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `option_choice_translations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `optionChoiceId` INTEGER NOT NULL,
    `locale` VARCHAR(5) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    UNIQUE INDEX `option_choice_translations_optionChoiceId_locale_key`(`optionChoiceId`, `locale`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================
-- 2. Add selectedOptions columns
-- ============================================

ALTER TABLE `cart_items` ADD COLUMN `selectedOptions` TEXT NOT NULL DEFAULT ('[]');
CREATE INDEX `cart_items_sessionId_menuItemId_idx` ON `cart_items`(`sessionId`, `menuItemId`);
DROP INDEX `cart_items_sessionId_menuItemId_key` ON `cart_items`;

ALTER TABLE `order_items` ADD COLUMN `selectedOptions` TEXT NOT NULL DEFAULT ('[]');

-- ============================================
-- 3. Fix FK constraints for cart/order protection
-- ============================================

-- OrderItem.menuItemId: nullable + SET NULL (allows menu item deletion without breaking finalized orders)
ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_menuItemId_fkey`;
ALTER TABLE `order_items` MODIFY COLUMN `menuItemId` INTEGER NULL;
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CartItem.menuItemId: CASCADE (auto-remove cart items when menu item is deleted)
ALTER TABLE `cart_items` DROP FOREIGN KEY `cart_items_menuItemId_fkey`;
ALTER TABLE `cart_items` ADD CONSTRAINT `cart_items_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- 4. Add foreign keys for option tables
-- ============================================

ALTER TABLE `option_groups` ADD CONSTRAINT `option_groups_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `option_group_translations` ADD CONSTRAINT `option_group_translations_optionGroupId_fkey` FOREIGN KEY (`optionGroupId`) REFERENCES `option_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `option_choices` ADD CONSTRAINT `option_choices_optionGroupId_fkey` FOREIGN KEY (`optionGroupId`) REFERENCES `option_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `option_choice_translations` ADD CONSTRAINT `option_choice_translations_optionChoiceId_fkey` FOREIGN KEY (`optionChoiceId`) REFERENCES `option_choices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
