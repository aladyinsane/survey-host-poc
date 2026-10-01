import { describe, expect, it } from "vitest";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

describe("tokens", () => {
  it("generates unique, well formed 256-bit tokens", () => {
    const a = generateToken();
    expect(isWellFormedToken(a)).toBe(true);
    expect(a).not.toBe(generateToken());
  });
  it("hashes deterministically to 32 bytes and never equals the token", () => {
    const t = generateToken();
    expect(hashToken(t)).toEqual(hashToken(t));
    expect(hashToken(t)).toHaveLength(32);
    expect(hashToken(t).toString("base64url")).not.toBe(t);
  });
  it("rejects malformed input", () => {
    for (const bad of ["", "short", "a".repeat(44), `${"a".repeat(42)}!`, undefined, 5, null]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});
