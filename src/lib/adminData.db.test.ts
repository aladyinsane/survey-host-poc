import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { changeOwner, exportCsv, listResponses } from "@/lib/adminData";
import { pool } from "@/lib/db";
import { emailHash } from "@/lib/email";
import { createResponse } from "@/lib/responses";
import { clearData, hasDb, resetDb } from "@/test/db";

function make(email: string, npi: string, orgName = "Acme Care") {
  return createResponse({ email, emailHash: emailHash(email), orgName, npi });
}

describe.skipIf(!hasDb)("admin data (database)", () => {
  beforeAll(resetDb);
  afterAll(() => pool().end());
  beforeEach(clearData);

  it("shows the owner address and flags live responses that share an NPI", async () => {
    await make("pat@acme.org", "1234567893");
    const sam = await make("sam@acme.org", "1234567893");
    await make("lee@other.org", "1245319599", "Other Health");
    const rows = await listResponses();
    const byEmail = Object.fromEntries(rows.map((r) => [r.ownerEmail, r]));
    expect(byEmail["pat@acme.org"].duplicateNpi).toBe(true);
    expect(byEmail["sam@acme.org"].duplicateNpi).toBe(true);
    expect(byEmail["lee@other.org"]).toMatchObject({ duplicateNpi: false, npi: "1245319599" });

    // Revoking one of the pair clears the flag on the other.
    await pool().query("UPDATE responses SET status = 'revoked' WHERE id = $1", [sam]);
    const after = await listResponses();
    expect(after.every((r) => !r.duplicateNpi)).toBe(true);
  });

  it("changes the owner of an in-progress response only, and never onto an address in use", async () => {
    const id = (await make("pat@acme.org", "1234567893"))!;
    await make("lee@other.org", "1245319599");
    expect(await changeOwner(id, "lee@other.org")).toBe("email_in_use");
    expect(await changeOwner(id, "sam@acme.org")).toBe("changed");
    expect((await listResponses()).find((r) => r.id === id)?.ownerEmail).toBe("sam@acme.org");
    await pool().query(
      "UPDATE responses SET status = 'submitted', submitted_at = now(), answers_enc = '\\x00' WHERE id = $1",
      [id],
    );
    expect(await changeOwner(id, "kim@acme.org")).toBe("not_in_progress");
  });

  it("exports NPI and owner email", async () => {
    await make("pat@acme.org", "1234567893");
    const [header, row] = (await exportCsv()).trim().split("\r\n");
    expect(header.split(",").slice(0, 5)).toEqual([
      "response_id",
      "organization",
      "npi",
      "owner_email",
      "status",
    ]);
    expect(row).toContain("1234567893,pat@acme.org,in_progress");
  });
});
