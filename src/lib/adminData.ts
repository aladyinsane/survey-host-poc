import { pool } from "./db";
import { decryptJson } from "./crypto";
import { encryptJson } from "./crypto";
import { emailHash } from "./email";
import { ownerAad } from "./responses";
import { endSessionsFor } from "./sessions";
import { allFields, survey, type SurveyAnswers } from "./survey";
import { csvRow } from "./csv";

// Nothing is deleted. Revoking and changing the owner change state and leave the row and audit trail.

function ownerEmail(r: { id: string; owner_email_enc: Buffer | null }): string {
  return r.owner_email_enc ? (decryptJson(r.owner_email_enc, ownerAad(r.id)) as string) : "";
}

export type AdminRow = {
  id: string;
  orgName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  ownerEmail: string;
  npi: string | null;
  duplicateNpi: boolean;
};

export async function listResponses(): Promise<AdminRow[]> {
  const { rows } = await pool().query(
    `SELECT id, org_name, status, created_at, updated_at, submitted_at, owner_email_enc, npi,
       npi IS NOT NULL AND status <> 'revoked' AND count(*) FILTER (WHERE status <> 'revoked')
         OVER (PARTITION BY survey_id, npi) > 1 AS duplicate_npi
     FROM responses ORDER BY created_at DESC LIMIT 1000`,
  );
  return rows.map((r) => ({
    id: r.id,
    orgName: r.org_name,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    submittedAt: r.submitted_at?.toISOString() ?? null,
    ownerEmail: ownerEmail(r),
    npi: r.npi,
    duplicateNpi: r.duplicate_npi,
  }));
}

// Only in-progress responses can be revoked; a submitted response is a finished record.
export async function revokeResponse(id: string): Promise<boolean> {
  const { rowCount } = await pool().query(
    "UPDATE responses SET status = 'revoked', updated_at = now() WHERE id = $1 AND status = 'in_progress'",
    [id],
  );
  return rowCount === 1;
}

export type OwnerChange = "changed" | "not_in_progress" | "email_in_use";

// For a respondent who left or handed off, after an out-of-band check. The old owner's sessions end.
export async function changeOwner(id: string, newEmail: string): Promise<OwnerChange> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      "SELECT owner_email_hash FROM responses WHERE id = $1 AND status = 'in_progress' FOR UPDATE",
      [id],
    );
    if (cur.rows.length === 0) {
      await client.query("ROLLBACK");
      return "not_in_progress";
    }
    await client.query(
      `UPDATE responses SET owner_email_hash = $2, owner_email_enc = $3, updated_at = now()
       WHERE id = $1`,
      [id, emailHash(newEmail), encryptJson(newEmail, ownerAad(id))],
    );
    await client.query("COMMIT");
    if (cur.rows[0].owner_email_hash) await endSessionsFor(cur.rows[0].owner_email_hash);
    return "changed";
  } catch (e) {
    await client.query("ROLLBACK");
    if ((e as { code?: string }).code === "23505") return "email_in_use";
    throw e;
  } finally {
    client.release();
  }
}

export async function exportCsv(): Promise<string> {
  const { rows } = await pool().query(
    `SELECT id, org_name, npi, owner_email_enc, status, created_at, submitted_at, answers_enc
     FROM responses WHERE survey_id = $1 ORDER BY created_at`,
    [survey.id],
  );
  const fields = allFields;
  let out = csvRow([
    "response_id",
    "organization",
    "npi",
    "owner_email",
    "status",
    "created_at",
    "submitted_at",
    ...fields.map((f) => f.key),
  ]);
  for (const r of rows) {
    const a = r.answers_enc ? (decryptJson(r.answers_enc, r.id) as SurveyAnswers) : {};
    out += csvRow([
      r.id,
      r.org_name,
      r.npi ?? "",
      ownerEmail(r),
      r.status,
      r.created_at.toISOString(),
      r.submitted_at?.toISOString() ?? "",
      ...fields.map((f) => a[f.key] ?? ""),
    ]);
  }
  return out;
}

export type AuditRow = { at: string; event: string; responseId: string | null };

export async function recentAudit(limit = 200): Promise<AuditRow[]> {
  const { rows } = await pool().query(
    "SELECT at, event, response_id FROM audit_log ORDER BY id DESC LIMIT $1",
    [limit],
  );
  return rows.map((r) => ({ at: r.at.toISOString(), event: r.event, responseId: r.response_id }));
}
