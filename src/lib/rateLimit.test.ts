import { describe, expect, it } from "vitest";
import { clientIp, rateLimit } from "./rateLimit";

describe("rateLimit", () => {
  it("blocks after the limit and resets after the window", () => {
    expect(rateLimit("a", 2, 1000, 0)).toBe(true);
    expect(rateLimit("a", 2, 1000, 1)).toBe(true);
    expect(rateLimit("a", 2, 1000, 2)).toBe(false);
    expect(rateLimit("a", 2, 1000, 1001)).toBe(true);
  });
  it("uses the proxy-appended (last) forwarded address", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "6.6.6.6, 1.2.3.4" } });
    expect(clientIp(req)).toBe("1.2.3.4");
    expect(clientIp(new Request("http://x"))).toBe("unknown");
  });
});
