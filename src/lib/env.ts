import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // 32 random bytes, base64 encoded (see .env.example for a one-line generator).
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
  // From: node scripts/hash-admin-password.mjs
  ADMIN_PASSWORD_HASH: z.string().startsWith("scrypt:"),
  // Any random string, 32+ chars. Signs admin session cookies.
  ADMIN_SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

// Lazy so `next build` works without secrets; startup migration or first request validates.
export function env(): Env {
  return (cached ??= schema.parse(process.env));
}
