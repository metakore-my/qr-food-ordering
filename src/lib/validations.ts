import { z } from "zod";
import { KNOWN_LOCALES } from "./deployment-config";

/** Locales accepted in translation payloads — the shipped superset. */
export const SUPPORTED_LOCALES = KNOWN_LOCALES;

export const translationSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional().nullable(),
});

export const optionChoiceSchema = z.object({
  priceAdjustment: z.number().min(0).default(0),
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
  choices: z.array(optionChoiceSchema).min(1),
});

export const passwordSchema = z
  .string()
  .min(8, { error: "Password must be at least 8 characters" })
  .max(16, { error: "Password must be at most 16 characters" })
  .regex(/[A-Z]/, { error: "Password must contain at least one uppercase letter" })
  .regex(/[a-z]/, { error: "Password must contain at least one lowercase letter" })
  .regex(/[0-9]/, { error: "Password must contain at least one digit" });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { error: "Current password is required" }),
  newPassword: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().min(1, { error: "Username is required" }),
  password: z.string().min(1, { error: "Password is required" }),
});
