import { z } from "zod";
import { KNOWN_LOCALES } from "./deployment-config";
import { roundMoney } from "./order-utils";

/** Locales accepted in translation payloads — the shipped superset. */
export const SUPPORTED_LOCALES = KNOWN_LOCALES;

/**
 * True if `value` carries no more fractional digits than the deployment
 * currency allows (e.g. 100.5 is invalid for 0-decimal VND). Zod can't enforce
 * this statically — `decimals` is a runtime setting — so menu write routes
 * check it after parsing. Without it a 0-decimal deployment could store a
 * fractional Decimal that every display path rounds differently from the
 * stored value (₫100.5 stored, ₫101 rendered).
 */
export function isValidPriceForDecimals(value: number, decimals: number): boolean {
  return roundMoney(value, decimals) === value;
}

/**
 * Walk a menu-item payload's money fields (`price`, `comboBasePrice`, option
 * choice `priceAdjustment`s) and return the path of the first one with more
 * fractional digits than the currency allows — or null when all conform.
 * Shared by the single-create, update, and batch menu routes.
 */
export function findInvalidPriceField(
  item: {
    price?: number;
    comboBasePrice?: number | null;
    optionGroups?: Array<{ choices: Array<{ priceAdjustment?: number }> }>;
  },
  decimals: number
): string | null {
  if (item.price != null && !isValidPriceForDecimals(item.price, decimals)) {
    return "price";
  }
  if (
    item.comboBasePrice != null &&
    !isValidPriceForDecimals(item.comboBasePrice, decimals)
  ) {
    return "comboBasePrice";
  }
  for (const group of item.optionGroups ?? []) {
    for (const choice of group.choices ?? []) {
      if (
        choice.priceAdjustment != null &&
        !isValidPriceForDecimals(choice.priceAdjustment, decimals)
      ) {
        return "optionGroups.choices.priceAdjustment";
      }
    }
  }
  return null;
}

/**
 * Upper bound on any single money field (price, comboBasePrice, priceAdjustment).
 * `z.number().positive()`/`.min(0)` reject NaN/Infinity (Zod v4 default) but not
 * a finite-but-absurd value like `1e18`, which would overflow downstream total
 * math and corrupt reports once stored as a Decimal. 10,000,000 covers every
 * realistic menu price across the MY/SG/TH/VN markets (incl. 0-decimal VND,
 * where tens-of-millions is plausible) while capping the blast radius.
 */
export const MAX_PRICE = 10_000_000;

/** Per-item caps on nested option payloads — without these a single write could
 *  carry thousands of groups × hundreds of choices, holding DB locks for minutes
 *  (the PATCH recreates groups in a transaction loop) or OOMing while Prisma
 *  builds the nested-create. Generous for any real restaurant menu. */
export const MAX_OPTION_GROUPS = 20;
export const MAX_OPTION_CHOICES = 50;

/** Shared money-value schema for menu writes: non-negative, finite, bounded. */
export const priceSchema = z.number().positive().max(MAX_PRICE);
export const priceAdjustmentSchema = z.number().min(0).max(MAX_PRICE);

export const translationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
});

export const optionChoiceSchema = z.object({
  priceAdjustment: priceAdjustmentSchema.default(0),
  sortOrder: z.number().int().optional(),
  translations: z.partialRecord(z.enum(SUPPORTED_LOCALES), z.object({
    name: z.string().min(1).max(100),
  }).optional()),
});

export const optionGroupSchema = z.object({
  selectionType: z.enum(["SINGLE", "MULTIPLE"]),
  isRequired: z.boolean(),
  sortOrder: z.number().int().optional(),
  translations: z.partialRecord(z.enum(SUPPORTED_LOCALES), z.object({
    name: z.string().min(1).max(100),
  }).optional()),
  choices: z.array(optionChoiceSchema).min(1).max(MAX_OPTION_CHOICES),
});

export const passwordSchema = z
  .string()
  .min(8, { error: "Password must be at least 8 characters" })
  .max(16, { error: "Password must be at most 16 characters" })
  .regex(/[A-Z]/, { error: "Password must contain at least one uppercase letter" })
  .regex(/[a-z]/, { error: "Password must contain at least one lowercase letter" })
  .regex(/[0-9]/, { error: "Password must contain at least one digit" });

/**
 * Assert a seed/env-supplied password meets the SAME `passwordSchema` the wizard
 * and the users API enforce. The DB seed (`prisma/seed.ts`) is the only
 * admin-creation path that hashes a raw env value, so without this it could
 * silently mint a SUPERADMIN weaker than policy. Throws (naming the offending
 * env var + every rule it broke) instead of seeding a sub-policy account; the
 * caller should validate ALL seed passwords BEFORE any DB write so a bad value
 * aborts atomically. Imported by both the seed and its unit test so the rule
 * can't drift. (Empty/unset values are skipped by the caller — not an error.)
 */
export function assertValidSeedPassword(envVar: string, value: string): void {
  const result = passwordSchema.safeParse(value);
  if (!result.success) {
    const reasons = result.error.issues.map((i) => `  - ${i.message}`).join("\n");
    throw new Error(
      `${envVar} does not meet the password policy:\n${reasons}\n` +
        `Set ${envVar} to a value with 8–16 characters including an uppercase ` +
        `letter, a lowercase letter, and a digit (or leave it empty to skip seeding this admin).`
    );
  }
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { error: "Current password is required" }),
  newPassword: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().min(1, { error: "Username is required" }),
  password: z.string().min(1, { error: "Password is required" }),
});

/**
 * Staff-assisted order placement payload (POST /api/admin/orders/place). Mirrors
 * the customer cart-add option caps (MAX_OPTION_GROUPS / MAX_OPTION_CHOICES) so a
 * staff line can't carry a larger nested payload than a customer line. Staff send
 * NO prices — the server computes unitPrice from live menu data — so there is no
 * price-precision check here. `expectedTotal` drives the same price-change guard
 * the customer path uses.
 */
const staffOrderLineSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().positive().max(99),
  selectedOptions: z
    .array(
      z.object({
        groupId: z.number().int().positive(),
        choiceIds: z.array(z.number().int().positive()).min(1).max(MAX_OPTION_CHOICES),
      })
    )
    .max(MAX_OPTION_GROUPS)
    .optional()
    .default([]),
});

export const staffPlaceOrderSchema = z
  .object({
    orderType: z.enum(["DINE_IN", "TAKEAWAY"]).default("DINE_IN"),
    tableNumber: z.number().int().positive().optional(),
    customerName: z.string().trim().max(100).optional(),
    idempotencyKey: z.string().min(1).max(128),
    expectedTotal: z.number().nonnegative().optional(),
    lines: z.array(staffOrderLineSchema).min(1).max(100),
  })
  .refine((d) => d.orderType === "TAKEAWAY" || d.tableNumber != null, {
    message: "Dine-in requires a table number",
    path: ["tableNumber"],
  });
