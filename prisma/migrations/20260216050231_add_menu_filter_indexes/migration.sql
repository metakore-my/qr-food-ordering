-- CreateIndex
CREATE INDEX `categories_isActive_idx` ON `categories`(`isActive`);

-- CreateIndex
CREATE INDEX `menu_items_isAvailable_idx` ON `menu_items`(`isAvailable`);

-- CreateIndex
CREATE INDEX `sessions_status_updatedAt_idx` ON `sessions`(`status`, `updatedAt`);
