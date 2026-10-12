import { pool } from "@/lib/db";
import { migrate } from "@/lib/migrate";

export const hasDb = !!process.env.TEST_DATABASE_URL;

// Fresh schema for a test file. Only ever pointed at TEST_DATABASE_URL.
export async function resetDb() {
  await pool().query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
}

// TRUNCATE skips the row-level delete guards, which is what tests want between cases.
export async function clearData() {
  await pool().query(
    "TRUNCATE responses, signin_codes, respondent_sessions, rate_limits, audit_log RESTART IDENTITY",
  );
}

const ORIGIN = "http://survey.test";

export function req(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  ip = "198.51.100.7",
) {
  const headers: Record<string, string> = {
    host: "survey.test",
    origin: ORIGIN,
    "x-forwarded-for": ip,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  return new Request(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// "respondent_session=abc; HttpOnly; ..." -> "respondent_session=abc"
export function cookieFrom(res: Response): string {
  const set = res.headers.get("set-cookie") ?? "";
  return set.split(";")[0];
}
