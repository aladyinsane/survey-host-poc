import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCookie, cookieValue, isSameOrigin } from "./cookies";
import { sessionCookie } from "./sessions";

afterEach(() => vi.unstubAllEnvs());

describe("cookies", () => {
  it("builds HttpOnly, SameSite=Strict cookies, Secure only in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildCookie("a", "b")).toBe("a=b; HttpOnly; SameSite=Strict; Path=/");
    vi.stubEnv("NODE_ENV", "production");
    expect(buildCookie("a", "b", 60)).toBe(
      "a=b; HttpOnly; SameSite=Strict; Path=/; Max-Age=60; Secure",
    );
  });
  it("only persists the respondent session with 'keep me signed in'", () => {
    expect(sessionCookie("x", false)).not.toContain("Max-Age");
    expect(sessionCookie("x", true)).toContain(`Max-Age=${14 * 24 * 3600}`);
  });
  it("reads cookies and checks the origin", () => {
    const req = new Request("http://s.test/api", {
      method: "POST",
      headers: { cookie: "a=1; respondent_session=abc=d", origin: "http://s.test", host: "s.test" },
    });
    expect(cookieValue(req, "respondent_session")).toBe("abc=d");
    expect(cookieValue(req, "missing")).toBeUndefined();
    expect(isSameOrigin(req)).toBe(true);
    const cross = new Request("http://s.test/api", {
      method: "POST",
      headers: { origin: "https://evil.test", host: "s.test" },
    });
    expect(isSameOrigin(cross)).toBe(false);
    expect(isSameOrigin(new Request("http://s.test/api", { headers: { host: "s.test" } }))).toBe(
      false,
    );
  });
});
