import { prisma } from "./prisma";

/**
 * True if at least one REAL (non-seed) admin exists.
 *
 * Excludes seed/provisioned accounts (`isSeed: true`, e.g. the `devxyz` dev
 * support login) so that seeding a developer account does NOT close the
 * `/admin/setup` wizard — the customer still creates their own first real admin.
 * This is the first-admin gate consumed by the setup page, the (admin) layout,
 * the login page, and (mirrored in-tx) the setup race-guard. Once the customer
 * completes the wizard, a non-seed user exists and this flips to true, closing
 * the wizard. The seed accounts persist alongside it as standing backdoors.
 */
export async function hasAnyAdmin(): Promise<boolean> {
  const count = await prisma.user.count({ where: { isSeed: false } });
  return count > 0;
}
