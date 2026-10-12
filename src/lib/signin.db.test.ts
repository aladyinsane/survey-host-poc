import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as codeRoute from "@/app/api/auth/code/route";
import * as signoutRoute from "@/app/api/auth/signout/route";
import * as verifyRoute from "@/app/api/auth/verify/route";
import * as meRoute from "@/app/api/responses/me/route";
import * as submitRoute from "@/app/api/responses/me/submit/route";
import * as startRoute from "@/app/api/responses/route";
import { changeOwner } from "@/lib/adminData";
import { pool } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { clearData, cookieFrom, hasDb, req, resetDb } from "@/test/db";

const full = {
  wage_rn: 40,
  wage_lpn: 30,
  wage_cna: 20,
  wage_admin: 25,
  net_revenue: 1000000,
  net_income: 50000,
};

// The log mail transport prints messages; capture them to read codes.
let logged: string[] = [];
const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => {
  logged.push(a.join(" "));
});

function lastCode(to: string): string {
  const m = [...logged].reverse().find((l) => l.includes(`to=${to} `) && l.includes("code is"));
  if (!m) throw new Error(`no code mailed to ${to}`);
  return /code is (\d{6})/.exec(m)![1];
}

async function requestCode(email: string, ip?: string) {
  return codeRoute.POST(req("/api/auth/code", "POST", { email }, undefined, ip));
}

async function signIn(email: string, remember = false): Promise<string> {
  expect((await requestCode(email)).status).toBe(202);
  const res = await verifyRoute.POST(
    req("/api/auth/verify", "POST", { email, code: lastCode(email), remember }),
  );
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

async function me(cookie: string) {
  const res = await meRoute.GET(req("/api/responses/me", "GET", undefined, cookie));
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}

async function start(cookie: string, npi = "1234567893", orgName = "Acme Care") {
  return startRoute.POST(req("/api/responses", "POST", { orgName, npi }, cookie));
}

describe.skipIf(!hasDb)("email code sign-in (database)", () => {
  beforeAll(resetDb);
  afterAll(async () => {
    logSpy.mockRestore();
    await pool().end();
  });
  beforeEach(async () => {
    await clearData();
    logged = [];
    delete process.env.SURVEY_CLOSES_AT;
    resetEnvCache();
  });

  describe("codes", () => {
    it("sign in with an emailed code, which then works only once", async () => {
      expect((await requestCode(" Pat@Provider.org ")).status).toBe(202);
      const code = lastCode("pat@provider.org");
      const ok = await verifyRoute.POST(
        req("/api/auth/verify", "POST", { email: "pat@provider.org", code, remember: false }),
      );
      expect(ok.status).toBe(200);
      expect(ok.headers.get("set-cookie")).toMatch(
        /^respondent_session=[A-Za-z0-9_-]{43}; HttpOnly/,
      );
      const again = await verifyRoute.POST(
        req("/api/auth/verify", "POST", { email: "pat@provider.org", code, remember: false }),
      );
      expect(again.status).toBe(401);
    });

    it("stores only hashes: no code or address in the database or audit log", async () => {
      await signIn("pat@provider.org");
      const dump = JSON.stringify(
        (
          await pool().query(
            `SELECT (SELECT json_agg(t) FROM signin_codes t) AS c,
                    (SELECT json_agg(t) FROM respondent_sessions t) AS s,
                    (SELECT json_agg(t) FROM audit_log t) AS a,
                    (SELECT json_agg(t) FROM rate_limits t) AS r`,
          )
        ).rows,
      );
      expect(dump).not.toContain("pat@provider.org");
      expect(dump).not.toContain("198.51.100.7");
    });

    it("five wrong guesses kill the code, even if the right one comes next", async () => {
      await requestCode("pat@provider.org");
      const code = lastCode("pat@provider.org");
      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 0; i < 5; i++) {
        const r = await verifyRoute.POST(
          req("/api/auth/verify", "POST", {
            email: "pat@provider.org",
            code: wrong,
            remember: false,
          }),
        );
        expect(r.status).toBe(401);
      }
      const right = await verifyRoute.POST(
        req("/api/auth/verify", "POST", { email: "pat@provider.org", code, remember: false }),
      );
      expect(right.status).toBe(401);
    });

    it("a new code kills the old one", async () => {
      await requestCode("pat@provider.org");
      const first = lastCode("pat@provider.org");
      let second = first;
      while (second === first) {
        await pool().query("TRUNCATE rate_limits");
        await requestCode("pat@provider.org");
        second = lastCode("pat@provider.org");
      }
      const old = await verifyRoute.POST(
        req("/api/auth/verify", "POST", {
          email: "pat@provider.org",
          code: first,
          remember: false,
        }),
      );
      expect(old.status).toBe(401);
      const cur = await verifyRoute.POST(
        req("/api/auth/verify", "POST", {
          email: "pat@provider.org",
          code: second,
          remember: false,
        }),
      );
      expect(cur.status).toBe(200);
    });

    it("an expired code fails", async () => {
      await requestCode("pat@provider.org");
      await pool().query("UPDATE signin_codes SET expires_at = now() - interval '1 second'");
      const r = await verifyRoute.POST(
        req("/api/auth/verify", "POST", {
          email: "pat@provider.org",
          code: lastCode("pat@provider.org"),
          remember: false,
        }),
      );
      expect(r.status).toBe(401);
    });

    it("limits codes per address per hour, and the window resets", async () => {
      for (let i = 0; i < 5; i++) expect((await requestCode("pat@provider.org")).status).toBe(202);
      const limited = await requestCode("pat@provider.org");
      expect(limited.status).toBe(429);
      expect((await limited.json()).error).toMatch(/most recent code/);
      // Another address is unaffected.
      expect((await requestCode("sam@provider.org")).status).toBe(202);
      await pool().query(
        "UPDATE rate_limits SET window_start = now() - interval '61 minutes' WHERE key LIKE 'code:email:%'",
      );
      expect((await requestCode("pat@provider.org")).status).toBe(202);
    });

    it("limits codes per address per day", async () => {
      for (let i = 0; i < 10; i++) {
        await pool().query("DELETE FROM rate_limits WHERE key LIKE 'code:email:%'");
        expect((await requestCode("pat@provider.org", `203.0.113.${i}`)).status).toBe(202);
      }
      await pool().query("DELETE FROM rate_limits WHERE key LIKE 'code:email:%'");
      expect((await requestCode("pat@provider.org", "203.0.113.99")).status).toBe(429);
    });

    it("limits code requests per IP", async () => {
      for (let i = 0; i < 20; i++)
        expect((await requestCode(`p${i}@provider.org`)).status).toBe(202);
      expect((await requestCode("p99@provider.org")).status).toBe(429);
    });

    it("rejects cross-site requests and bad input", async () => {
      const cross = new Request("http://survey.test/api/auth/code", {
        method: "POST",
        headers: {
          host: "survey.test",
          origin: "https://evil.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "pat@provider.org" }),
      });
      expect((await codeRoute.POST(cross)).status).toBe(403);
      expect((await codeRoute.POST(req("/api/auth/code", "POST", { email: "nope" }))).status).toBe(
        400,
      );
      expect(
        (await verifyRoute.POST(req("/api/auth/verify", "POST", { email: "a@b.org", code: "12" })))
          .status,
      ).toBe(400);
    });

    it("does not leave a usable code when the email fails to send", async () => {
      const { requestCode: lib } = await import("@/lib/signin");
      const result = await lib("pat@provider.org", "192.0.2.1", async () => {
        throw new Error("smtp down");
      });
      expect(result).toBe("send_failed");
      expect((await pool().query("SELECT count(*)::int AS n FROM signin_codes")).rows[0].n).toBe(0);
    });
  });

  describe("sessions", () => {
    it("are required for the respondent API", async () => {
      expect((await me("")).status).toBe(401);
      expect((await me("respondent_session=" + "a".repeat(43))).status).toBe(401);
    });

    it("end after 2 hours idle by default", async () => {
      const cookie = await signIn("pat@provider.org");
      expect((await me(cookie)).status).toBe(200);
      await pool().query(
        "UPDATE respondent_sessions SET last_seen_at = now() - interval '121 minutes'",
      );
      expect((await me(cookie)).status).toBe(401);
    });

    it("end after 12 hours in total even when active", async () => {
      const cookie = await signIn("pat@provider.org");
      await pool().query(
        "UPDATE respondent_sessions SET expires_at = created_at + interval '12 hours' - interval '13 hours'",
      );
      expect((await me(cookie)).status).toBe(401);
    });

    it("with 'keep me signed in' last 14 days and survive a long break", async () => {
      const cookie = await signIn("pat@provider.org", true);
      const row = (
        await pool().query(
          "SELECT idle_seconds, extract(epoch FROM expires_at - created_at)::int AS total FROM respondent_sessions",
        )
      ).rows[0];
      expect(row).toEqual({ idle_seconds: 14 * 86400, total: 14 * 86400 });
      await pool().query("UPDATE respondent_sessions SET last_seen_at = now() - interval '3 days'");
      expect((await me(cookie)).status).toBe(200);
    });

    it("end on sign-out", async () => {
      const cookie = await signIn("pat@provider.org");
      const out = await signoutRoute.POST(req("/api/auth/signout", "POST", undefined, cookie));
      expect(out.status).toBe(204);
      expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await me(cookie)).status).toBe(401);
    });

    it("end for the old owner when an admin changes the owner", async () => {
      const cookie = await signIn("pat@provider.org");
      await start(cookie);
      const id = (await pool().query("SELECT id FROM responses")).rows[0].id;
      expect(await changeOwner(id, "sam@provider.org")).toBe("changed");
      expect((await me(cookie)).status).toBe(401);
      const sam = await signIn("sam@provider.org");
      expect((await me(sam)).body.response.orgName).toBe("Acme Care");
      const pat = await signIn("pat@provider.org");
      expect((await me(pat)).body.response).toBeNull();
    });
  });

  describe("responses", () => {
    it("start, save, resume on another device, submit, then read-only", async () => {
      const a = await signIn("pat@provider.org");
      expect((await me(a)).body).toMatchObject({ email: "pat@provider.org", response: null });
      expect((await start(a)).status).toBe(201);
      expect(logged.some((l) => l.includes("to=pat@provider.org subject=You started"))).toBe(true);

      const put = await meRoute.PUT(
        req("/api/responses/me", "PUT", { answers: { wage_rn: 41 }, version: 0 }, a),
      );
      expect(put.status).toBe(200);
      expect((await put.json()).version).toBe(1);

      const b = await signIn("pat@provider.org"); // a second device
      const resumed = (await me(b)).body.response;
      expect(resumed).toMatchObject({ npi: "1234567893", status: "in_progress", version: 1 });
      expect(resumed.answers.wage_rn).toBe(41);

      const sub = await submitRoute.POST(
        req("/api/responses/me/submit", "POST", { answers: full, version: 1 }, b),
      );
      expect(sub.status).toBe(200);
      expect(logged.some((l) => l.includes("subject=We received"))).toBe(true);
      expect(logged.join("\n")).not.toContain("1000000");

      const after = (await me(a)).body.response;
      expect(after.status).toBe("submitted");
      expect(after.answers).toEqual(full);
      const late = await meRoute.PUT(
        req("/api/responses/me", "PUT", { answers: { wage_rn: 1 }, version: 2 }, a),
      );
      expect(late.status).toBe(409);
      expect((await late.json()).reason).toBe("submitted");
    });

    it("stores the owner address and answers encrypted", async () => {
      const a = await signIn("pat@provider.org");
      await start(a);
      await meRoute.PUT(
        req("/api/responses/me", "PUT", { answers: { wage_rn: 987654 }, version: 0 }, a),
      );
      const dump = JSON.stringify((await pool().query("SELECT * FROM responses")).rows);
      expect(dump).not.toContain("pat@provider.org");
      expect(dump).not.toContain("987654");
    });

    it("refuses a save from a stale version (another window or device)", async () => {
      const a = await signIn("pat@provider.org");
      await start(a);
      const one = await meRoute.PUT(
        req("/api/responses/me", "PUT", { answers: { wage_rn: 1 }, version: 0 }, a),
      );
      expect(one.status).toBe(200);
      const stale = await meRoute.PUT(
        req("/api/responses/me", "PUT", { answers: { wage_rn: 2 }, version: 0 }, a),
      );
      expect(stale.status).toBe(409);
      expect((await stale.json()).reason).toBe("changed");
    });

    it("allows one live response per address, and a revoked one frees the address", async () => {
      const a = await signIn("pat@provider.org");
      expect((await start(a)).status).toBe(201);
      expect((await start(a)).status).toBe(409);
      await pool().query("UPDATE responses SET status = 'revoked'");
      expect((await me(a)).body.response).toBeNull();
      expect((await start(a)).status).toBe(201);
    });

    it("rejects an invalid NPI", async () => {
      const a = await signIn("pat@provider.org");
      const r = await start(a, "1234567890");
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/NPI/);
    });

    it("refuses start, save, and submit after the close date, but still shows the response", async () => {
      const a = await signIn("pat@provider.org");
      await start(a);
      const b = await signIn("sam@provider.org");
      process.env.SURVEY_CLOSES_AT = new Date(Date.now() - 1000).toISOString();
      resetEnvCache();

      const view = (await me(a)).body;
      expect(view.closed).toBe(true);
      expect(view.response.status).toBe("in_progress");
      const put = await meRoute.PUT(
        req("/api/responses/me", "PUT", { answers: { wage_rn: 1 }, version: 0 }, a),
      );
      expect(put.status).toBe(403);
      expect((await put.json()).reason).toBe("closed");
      const sub = await submitRoute.POST(
        req("/api/responses/me/submit", "POST", { answers: full, version: 0 }, a),
      );
      expect(sub.status).toBe(403);
      expect((await start(b, "1245319599")).status).toBe(403);
      // Signing in still works after the close date, to view and print.
      expect((await requestCode("pat@provider.org")).status).toBe(202);
    });

    it("blocks changes to the owner or NPI of a submitted response in the database itself", async () => {
      const a = await signIn("pat@provider.org");
      await start(a);
      await submitRoute.POST(
        req("/api/responses/me/submit", "POST", { answers: full, version: 0 }, a),
      );
      await expect(pool().query("UPDATE responses SET npi = '1245319599'")).rejects.toThrow(
        /immutable/,
      );
      await expect(
        pool().query("UPDATE responses SET owner_email_hash = decode(repeat('00', 32), 'hex')"),
      ).rejects.toThrow(/immutable/);
    });
  });
});
