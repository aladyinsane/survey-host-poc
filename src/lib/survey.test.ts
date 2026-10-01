import { describe, expect, it } from "vitest";
import { draftSchema, finalSchema, orgNameSchema } from "./survey";

const full = {
  wage_rn: 40,
  wage_lpn: 30,
  wage_cna: 20,
  wage_admin: 25,
  net_revenue: 1000000,
  net_income: 50000,
};

describe("answer validation", () => {
  it("allows partial drafts with blanks", () => {
    expect(draftSchema.safeParse({ wage_rn: 40, wage_lpn: null }).success).toBe(true);
    expect(draftSchema.safeParse({}).success).toBe(true);
  });
  it("requires every field to submit", () => {
    expect(finalSchema.safeParse(full).success).toBe(true);
    expect(finalSchema.safeParse({ ...full, wage_rn: null }).success).toBe(false);
    const missing: Partial<typeof full> = { ...full };
    delete missing.net_income;
    expect(finalSchema.safeParse(missing).success).toBe(false);
  });
  it("rejects unknown keys, negatives, and non-numbers", () => {
    expect(draftSchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(draftSchema.safeParse({ wage_rn: -1 }).success).toBe(false);
    expect(draftSchema.safeParse({ wage_rn: "40" }).success).toBe(false);
    expect(draftSchema.safeParse({ wage_rn: 1e13 }).success).toBe(false);
  });
  it("validates organization names", () => {
    expect(orgNameSchema.safeParse("  Acme Care  ").data).toBe("Acme Care");
    expect(orgNameSchema.safeParse("   ").success).toBe(false);
    expect(orgNameSchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});
