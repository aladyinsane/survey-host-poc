import { createHmac, hkdfSync } from "node:crypto";
import { env } from "./env";

// Hashing keys are derived from DATA_ENCRYPTION_KEY, one label each, so no new secrets are needed
// and no key can stand in for another.
export type KeyLabel = "email-lookup-v1" | "signin-code-v1" | "rate-limit-ip-v1";

const cache = new Map<string, Buffer>();

export function deriveKey(label: KeyLabel, master?: Buffer): Buffer {
  if (master) return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), label, 32));
  let k = cache.get(label);
  if (!k) {
    k = deriveKey(label, Buffer.from(env().DATA_ENCRYPTION_KEY, "base64"));
    cache.set(label, k);
  }
  return k;
}

export function hmac(label: KeyLabel, ...parts: (string | Buffer)[]): Buffer {
  const h = createHmac("sha256", deriveKey(label));
  for (const p of parts) h.update(p);
  return h.digest();
}
