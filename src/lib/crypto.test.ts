import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "./crypto";

const key = randomBytes(32);

describe("field encryption", () => {
  it("round trips", () => {
    const v = { wage_rn: 41.5, net_revenue: 1_200_000, blank: null };
    expect(decryptJson(encryptJson(v, "id-1", key), "id-1", key)).toEqual(v);
  });
  it("uses a fresh IV each time and hides the plaintext", () => {
    const a = encryptJson({ n: 123456 }, "id-1", key);
    const b = encryptJson({ n: 123456 }, "id-1", key);
    expect(a.equals(b)).toBe(false);
    expect(a.toString("utf8")).not.toContain("123456");
  });
  it("fails for a different row id (ciphertext cannot be moved)", () => {
    expect(() => decryptJson(encryptJson({ n: 1 }, "id-1", key), "id-2", key)).toThrow();
  });
  it("fails for the wrong key or tampered data", () => {
    const blob = encryptJson({ n: 1 }, "id-1", key);
    expect(() => decryptJson(blob, "id-1", randomBytes(32))).toThrow();
    blob[blob.length - 1] ^= 1;
    expect(() => decryptJson(blob, "id-1", key)).toThrow();
  });
});
