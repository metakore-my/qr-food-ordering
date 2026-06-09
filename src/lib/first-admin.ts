import { prisma } from "./prisma";

/** True if at least one user account exists (any role). */
export async function hasAnyAdmin(): Promise<boolean> {
  const count = await prisma.user.count();
  return count > 0;
}
