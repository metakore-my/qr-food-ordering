export const ASSIGNABLE_PERMISSIONS = ["menu", "tables", "reports", "orders"] as const;

export type Permission = (typeof ASSIGNABLE_PERMISSIONS)[number];

export function parsePermissions(raw: string): Permission[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: unknown): p is Permission =>
      typeof p === "string" && ASSIGNABLE_PERMISSIONS.includes(p as Permission)
    );
  } catch {
    return [];
  }
}

export function hasPermission(
  role: string,
  permissions: Permission[],
  required: Permission
): boolean {
  if (role === "SUPERADMIN") return true;
  return permissions.includes(required);
}
