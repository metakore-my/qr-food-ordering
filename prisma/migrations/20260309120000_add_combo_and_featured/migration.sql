-- Add combo and featured fields to menu_items
ALTER TABLE `menu_items` ADD COLUMN `isCombo` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `menu_items` ADD COLUMN `isFeatured` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `menu_items` ADD COLUMN `comboBasePrice` DECIMAL(10, 2) NULL;
