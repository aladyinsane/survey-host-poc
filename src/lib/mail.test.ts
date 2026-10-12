import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "./env";
import { codeMail, graphSender, mailpitSender } from "./mail";

const base = {
  DATABASE_URL: "postgres://x",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
  ADMIN_PASSWORD_HASH: "scrypt:1:1:1:a:b",
  ADMIN_SESSION_SECRET: "s".repeat(32),
};

describe("mail settings", () => {
  it("defaults to the log transport and treats blanks as unset", () => {
    expect(parseEnv({ ...base, MAIL_TRANSPORT: "" }).MAIL_TRANSPORT).toBe("log");
  });
  it("requires the Graph settings for graph, and Mailpit settings for mailpit", () => {
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: "graph", MAIL_FROM: "n@x.org" })).toThrow(
      /GRAPH_TENANT_ID/,
    );
    expect(() => parseEnv({ ...base, MAIL_TRANSPORT: "mailpit" })).toThrow(/MAILPIT_URL/);
  });
  it("validates the close date", () => {
    expect(() => parseEnv({ ...base, SURVEY_CLOSES_AT: "next week" })).toThrow();
    expect(
      parseEnv({ ...base, SURVEY_CLOSES_AT: "2027-01-15T23:59:00-05:00" }).SURVEY_CLOSES_AT,
    ).toBe("2027-01-15T23:59:00-05:00");
  });
});

describe("Graph sender", () => {
  const e = parseEnv({
    ...base,
    MAIL_TRANSPORT: "graph",
    MAIL_FROM: "no-reply@x.org",
    GRAPH_TENANT_ID: "tenant",
    GRAPH_CLIENT_ID: "client",
    GRAPH_CLIENT_SECRET: "secret",
  });

  it("gets a token once, caches it, and sends a plain-text message", async () => {
    const f = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/token")
        ? Response.json({ access_token: "tok", expires_in: 3600 })
        : new Response(null, { status: 202 }),
    );
    const send = graphSender(e, f);
    await send(codeMail("pat@provider.org", "123456"));
    await send(codeMail("pat@provider.org", "654321"));
    const calls = f.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes("/token"))).toHaveLength(1);
    expect(calls[0]).toBe("https://login.microsoftonline.com/tenant/oauth2/v2.0/token");
    expect(calls[1]).toBe("https://graph.microsoft.com/v1.0/users/no-reply%40x.org/sendMail");
    const init = f.mock.calls[1][1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const body = JSON.parse(String(init.body));
    expect(body.saveToSentItems).toBe(false);
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "pat@provider.org" } }]);
    expect(body.message.body).toEqual({
      contentType: "Text",
      content: expect.stringContaining("123456"),
    });
    expect(body.message.subject).not.toContain("123456");
  });

  it("throws when Graph does not accept the message", async () => {
    const f = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/token")
        ? Response.json({ access_token: "tok", expires_in: 3600 })
        : new Response("denied", { status: 403 }),
    );
    await expect(graphSender(e, f)(codeMail("a@x.org", "1"))).rejects.toThrow(/403/);
  });
});

describe("Mailpit sender", () => {
  it("posts to the Mailpit send API", async () => {
    const e = parseEnv({
      ...base,
      MAIL_TRANSPORT: "mailpit",
      MAIL_FROM: "n@x.org",
      MAILPIT_URL: "http://mp:8025",
    });
    const f = vi.fn<typeof fetch>(async () => Response.json({ ID: "1" }));
    await mailpitSender(
      e,
      f as unknown as typeof fetch,
    )({ to: "a@x.org", subject: "S", text: "T" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://mp:8025/api/v1/send");
    expect(JSON.parse(String(init!.body))).toEqual({
      From: { Email: "n@x.org" },
      To: [{ Email: "a@x.org" }],
      Subject: "S",
      Text: "T",
    });
  });
});
