import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

describe("email normalization and hashing", () => {
  it("trims, lowercases, and hashes equal addresses alike", async () => {
    const { emailHash, emailSchema } = await import("./email");
    const a = emailSchema.parse("  Pat@Provider.ORG ");
    expect(a).toBe("pat@provider.org");
    expect(emailHash(a)).toEqual(emailHash(emailSchema.parse("pat@provider.org")));
    expect(emailHash(a)).toHaveLength(32);
    expect(emailHash(a).toString("hex")).not.toContain("pat");
  });
  it("rejects invalid or overlong addresses", async () => {
    const { emailSchema } = await import("./email");
    for (const bad of ["", "pat", "pat@", `${"a".repeat(250)}@x.org`])
      expect(emailSchema.safeParse(bad).success).toBe(false);
  });
});

describe("derived keys", () => {
  it("differ by label and from the master key", async () => {
    const { deriveKey } = await import("./keys");
    const master = randomBytes(32);
    const a = deriveKey("email-lookup-v1", master);
    const b = deriveKey("signin-code-v1", master);
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(false);
    expect(a.equals(master)).toBe(false);
    expect(deriveKey("email-lookup-v1", master)).toEqual(a);
  });
});

describe("codes", () => {
  it("are always 6 digits", async () => {
    const { generateCode } = await import("./signin");
    for (let i = 0; i < 2000; i++) expect(generateCode()).toMatch(/^[0-9]{6}$/);
  });
  it("hash differently per address and per code", async () => {
    const { codeHash } = await import("./signin");
    const { emailHash } = await import("./email");
    const a = emailHash("a@x.org");
    const b = emailHash("b@x.org");
    expect(codeHash(a, "123456")).toEqual(codeHash(a, "123456"));
    expect(codeHash(a, "123456").equals(codeHash(b, "123456"))).toBe(false);
    expect(codeHash(a, "123456").equals(codeHash(a, "123457"))).toBe(false);
  });
});
