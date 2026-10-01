import { describe, expect, it } from "vitest";
import {
  createSession,
  hashPassword,
  SESSION_MS,
  verifyPassword,
  verifySession,
} from "./adminAuth";
import { csvCell, csvRow } from "./csv";

describe("admin password", () => {
  it("verifies the right password and rejects others", () => {
    const h = hashPassword("correct horse battery");
    expect(h).not.toContain("$");
    expect(verifyPassword("correct horse battery", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "bcrypt:1:2:3:a:b")).toBe(false);
  });
});

describe("admin session", () => {
  const secret = "s".repeat(32);
  it("accepts a fresh session and rejects expired, tampered, or wrong-secret ones", () => {
    const s = createSession(secret, 1000);
    expect(verifySession(s, secret, 1001)).toBe(true);
    expect(verifySession(s, secret, 1000 + SESSION_MS + 1)).toBe(false);
    expect(verifySession(s, "t".repeat(32), 1001)).toBe(false);
    const [, mac] = s.split(".");
    expect(verifySession(`${99999999999999}.${mac}`, secret, 1001)).toBe(false);
    expect(verifySession(undefined, secret)).toBe(false);
    expect(verifySession("garbage", secret)).toBe(false);
  });
});

describe("csv", () => {
  it("quotes and escapes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvRow(["x", 1, null])).toBe("x,1,\r\n");
  });
  it("neutralizes formula injection in strings but leaves numbers alone", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("-5");
  });
});
