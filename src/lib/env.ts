import { z } from "zod";

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    // 32 random bytes, base64 encoded (see .env.example for a one-line generator). Also the HKDF
    // source for the email, code, and IP hashing keys (see keys.ts).
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
    // From: node scripts/hash-admin-password.mjs
    ADMIN_PASSWORD_HASH: z.string().startsWith("scrypt:"),
    // Any random string, 32+ chars. Signs admin session cookies.
    ADMIN_SESSION_SECRET: z.string().min(32),

    // How sign-in codes are sent. `log` writes them to stdout: demos only, never real respondents.
    MAIL_TRANSPORT: z.enum(["graph", "mailpit", "log"]).default("log"),
    MAIL_FROM: z.email().optional(),
    GRAPH_TENANT_ID: z.string().min(1).optional(),
    GRAPH_CLIENT_ID: z.string().min(1).optional(),
    GRAPH_CLIENT_SECRET: z.string().min(1).optional(),
    MAILPIT_URL: z.url().optional(),

    // Used in emails. Never derived from the request's Host header, which a caller controls.
    PUBLIC_URL: z.url().optional(),
    // After this, nobody can start, save, or submit. Unset means the survey never closes.
    SURVEY_CLOSES_AT: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((e, ctx) => {
    const need = (keys: (keyof typeof e)[]) => {
      for (const k of keys)
        if (!e[k])
          ctx.addIssue({ code: "custom", path: [k], message: `required for ${e.MAIL_TRANSPORT}` });
    };
    if (e.MAIL_TRANSPORT === "graph")
      need(["MAIL_FROM", "GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"]);
    if (e.MAIL_TRANSPORT === "mailpit") need(["MAIL_FROM", "MAILPIT_URL"]);
  });

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings (common in .env files and compose) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  return schema.parse(cleaned);
}

// Lazy so `next build` works without secrets; startup migration or first request validates.
export function env(): Env {
  return (cached ??= parseEnv(process.env));
}

// Tests change settings such as SURVEY_CLOSES_AT between cases.
export function resetEnvCache(): void {
  cached = undefined;
}
