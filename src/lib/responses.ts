import { pool } from "./db";
import { decryptJson, encryptJson } from "./crypto";
import { env } from "./env";
import { survey, type SurveyAnswers } from "./survey";

export type ResponseView = {
  id: string;
  orgName: string;
  npi: string | null;
  status: "in_progress" | "submitted";
  answers: SurveyAnswers;
  version: number;
  updatedAt: string;
  submittedAt: string | null;
};

export function closesAt(): Date | null {
  const v = env().SURVEY_CLOSES_AT;
  return v ? new Date(v) : null;
}

export function isClosed(now = new Date()): boolean {
  const c = closesAt();
  return c !== null && now >= c;
}

export function ownerAad(responseId: string): string {
  return `owner:${responseId}`;
}

// Revoked responses are treated as absent: the address can start again (and the admin page flags
// the repeated NPI).
export async function findByOwner(emailHash: Buffer): Promise<ResponseView | null> {
  const { rows } = await pool().query(
    `SELECT id, org_name, npi, status, answers_enc, version, updated_at, submitted_at
     FROM responses WHERE survey_id = $1 AND owner_email_hash = $2 AND status <> 'revoked'`,
    [survey.id, emailHash],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    orgName: r.org_name,
    npi: r.npi,
    status: r.status,
    answers: r.answers_enc ? (decryptJson(r.answers_enc, r.id) as SurveyAnswers) : {},
    version: r.version,
    updatedAt: r.updated_at.toISOString(),
    submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
  };
}

export async function liveResponseId(emailHash: Buffer): Promise<string | null> {
  const { rows } = await pool().query(
    "SELECT id FROM responses WHERE survey_id = $1 AND owner_email_hash = $2 AND status <> 'revoked'",
    [survey.id, emailHash],
  );
  return rows[0]?.id ?? null;
}

// Returns null if this address already owns a live response (the unique index decides races).
export async function createResponse(input: {
  email: string;
  emailHash: Buffer;
  orgName: string;
  npi: string;
}): Promise<string | null> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO responses (survey_id, org_name, npi, owner_email_hash) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [survey.id, input.orgName, input.npi, input.emailHash],
    );
    const id: string = rows[0].id;
    // The encrypted address is bound to the row id, so it is written once the id exists.
    await client.query("UPDATE responses SET owner_email_enc = $2 WHERE id = $1", [
      id,
      encryptJson(input.email, ownerAad(id)),
    ]);
    await client.query("COMMIT");
    return id;
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") return null;
    throw e;
  } finally {
    client.release();
  }
}

export type WriteResult =
  | { ok: true; version: number; updatedAt: string; submittedAt: string | null }
  | { ok: false; reason: "submitted" | "changed" | "closed" | "missing" };

// Both writes only match an in-progress row at the expected version before the close date, so a
// submitted response cannot change and two parallel saves cannot both win.
async function write(
  id: string,
  answers: SurveyAnswers,
  version: number,
  submit: boolean,
): Promise<WriteResult> {
  const { rows } = await pool().query(
    `UPDATE responses SET answers_enc = $2, version = version + 1, updated_at = now()
       ${submit ? ", status = 'submitted', submitted_at = now()" : ""}
     WHERE id = $1 AND status = 'in_progress' AND version = $3
       AND ($4::timestamptz IS NULL OR now() < $4::timestamptz)
     RETURNING version, updated_at, submitted_at`,
    [id, encryptJson(answers, id), version, closesAt()],
  );
  if (rows.length === 1) {
    const r = rows[0];
    return {
      ok: true,
      version: r.version,
      updatedAt: r.updated_at.toISOString(),
      submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
    };
  }
  const cur = await pool().query("SELECT status, version FROM responses WHERE id = $1", [id]);
  const row = cur.rows[0];
  if (!row || row.status === "revoked") return { ok: false, reason: "missing" };
  if (row.status === "submitted") return { ok: false, reason: "submitted" };
  if (isClosed()) return { ok: false, reason: "closed" };
  return { ok: false, reason: "changed" };
}

export function saveAnswers(id: string, answers: SurveyAnswers, version: number) {
  return write(id, answers, version, false);
}

export function submitAnswers(id: string, answers: SurveyAnswers, version: number) {
  return write(id, answers, version, true);
}
