import { pool } from "./db";
import { decryptJson } from "./crypto";
import { generateToken, hashToken } from "./tokens";
import { allFields, type SurveyAnswers } from "./survey";
import { csvRow } from "./csv";

// Nothing is deleted. Revoking and reissuing change state and leave the row and audit trail.

export type AdminRow = {
  id: string;
  orgName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  expiresAt: string;
};

export async function listResponses(): Promise<AdminRow[]> {
  const { rows } = await pool().query(
    `SELECT id, org_name, status, created_at, updated_at, submitted_at, expires_at
     FROM responses ORDER BY created_at DESC LIMIT 1000`,
  );
  return rows.map((r) => ({
    id: r.id,
    orgName: r.org_name,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    submittedAt: r.submitted_at?.toISOString() ?? null,
    expiresAt: r.expires_at.toISOString(),
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

// Rotates the token: the old link stops working immediately. Returns the new token once.
// Also restarts the 90 day window so a reissued link is not already expired.
export async function reissueToken(id: string): Promise<string | null> {
  const token = generateToken();
  const { rowCount } = await pool().query(
    `UPDATE responses SET token_hash = $2, updated_at = now(), expires_at = now() + interval '90 days'
     WHERE id = $1 AND status = 'in_progress'`,
    [id, hashToken(token)],
  );
  return rowCount === 1 ? token : null;
}

export async function exportCsv(): Promise<string> {
  const { rows } = await pool().query(
    "SELECT id, org_name, status, created_at, submitted_at, answers_enc FROM responses ORDER BY created_at",
  );
  const fields = allFields;
  let out = csvRow([
    "response_id",
    "organization",
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
