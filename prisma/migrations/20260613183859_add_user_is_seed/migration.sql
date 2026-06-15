-- AlterTable
-- Seed/provisioned accounts (e.g. the dev support login) are flagged so they do
-- NOT count toward the first-admin gate: seeding `devxyz` leaves the /admin/setup
-- wizard open for the customer to create their own first real admin.
ALTER TABLE `users` ADD COLUMN `isSeed` BOOLEAN NOT NULL DEFAULT false;
