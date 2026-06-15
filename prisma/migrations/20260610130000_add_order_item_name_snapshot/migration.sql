-- AlterTable: snapshot the dish name on each order line so historical orders and
-- reports survive a later menu-item rename or delete (menuItem is ON DELETE SET
-- NULL). Mirrors the existing unitPrice / selectedOptions snapshots. Nullable so
-- pre-existing rows and the backfill below are clean; new rows are written with
-- the canonical-locale name by the order-placement route.
ALTER TABLE `order_items` ADD COLUMN `itemName` VARCHAR(255) NULL;

-- Resolve the deployment's canonical locale (the locale whose name is the
-- snapshot source), defaulting to 'en' when the setting is absent.
SET @canonical := COALESCE(
  (SELECT `value` FROM `system_settings` WHERE `key` = 'canonical_locale' LIMIT 1),
  'en'
);

-- Backfill existing rows from the CURRENT menu translations. This is best-effort
-- (it uses whatever the name is at migration time, since no historical snapshot
-- exists yet) and is the most faithful value available. Prefer the canonical
-- locale; fall back to any translation for that item; leave NULL only when the
-- source menu item was already deleted (menuItemId NULL) — those read as the
-- "deleted item" label, exactly as before.
UPDATE `order_items` `oi`
SET `oi`.`itemName` = COALESCE(
  (
    SELECT `t`.`name`
    FROM `menu_item_translations` `t`
    WHERE `t`.`menuItemId` = `oi`.`menuItemId`
      AND `t`.`locale` = @canonical
    LIMIT 1
  ),
  (
    SELECT `t2`.`name`
    FROM `menu_item_translations` `t2`
    WHERE `t2`.`menuItemId` = `oi`.`menuItemId`
    ORDER BY `t2`.`id` ASC
    LIMIT 1
  )
)
WHERE `oi`.`menuItemId` IS NOT NULL
  AND `oi`.`itemName` IS NULL;
