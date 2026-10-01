import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

// Layout: [version:1][iv:12][tag:16][ciphertext]. The response id is bound as AAD, so a ciphertext
// copied onto another row fails to decrypt.
const VERSION = 1;

function key(): Buffer {
  return Buffer.from(env().DATA_ENCRYPTION_KEY, "base64");
}

export function encryptJson(value: unknown, aad: string, k: Buffer = key()): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

export function decryptJson(blob: Buffer, aad: string, k: Buffer = key()): unknown {
  if (blob.length < 29 || blob[0] !== VERSION) throw new Error("unsupported ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", k, blob.subarray(1, 13));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(blob.subarray(13, 29));
  const pt = Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
}
