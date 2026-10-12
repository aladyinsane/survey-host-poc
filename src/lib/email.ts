import { z } from "zod";
import { hmac } from "./keys";

// Trim, Unicode NFC, lowercase. Every lookup and hash goes through this.
export const emailSchema = z
  .string()
  .transform((v) => v.trim().normalize("NFC").toLowerCase())
  .pipe(z.email().max(254));

// Stable lookup key for an address. Keyed, so a database leak cannot be checked against a list.
export function emailHash(normalizedEmail: string): Buffer {
  return hmac("email-lookup-v1", normalizedEmail);
}
