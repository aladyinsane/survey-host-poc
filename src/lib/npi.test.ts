import { describe, expect, it } from "vitest";
import { isValidNpi } from "./npi";

describe("NPI check digit", () => {
  it("accepts valid NPIs", () => {
    for (const npi of ["1234567893", "1245319599", "1003000126"])
      expect(isValidNpi(npi)).toBe(true);
  });
  it("rejects a wrong check digit, wrong length, and non-digits", () => {
    for (const bad of ["1234567890", "1234567894", "123456789", "12345678930", "12345678a3", ""])
      expect(isValidNpi(bad)).toBe(false);
  });
});
