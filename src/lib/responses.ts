import { pool } from "./db";
import { decryptJson, encryptJson } from "./crypto";
import { generateToken, hashToken } from "./tokens";
import { survey, type SurveyAnswers } from "./survey";

export type ResponseView = {
  id: string;
  orgName: string;
  status: "in_progress" | "submitted";
  answers: SurveyAnswers;
  updatedAt: string;
  submittedAt: string | null;
};

export async function createResponse(orgName: string): Promise<{ id: string; token: string }> {
  const token = generateToken();
  const { rows } = await pool().query(
    "INSERT INTO responses (survey_id, token_hash, org_name) VALUES ($1, $2, $3) RETURNING id",
    [survey.id, hashToken(token), orgName],
  );
  return { id: rows[0].id, token };
}

// Revoked and expired responses look exactly like unknown tokens.
export async function findByToken(token: string): Promise<ResponseView | null> {
  const { rows } = await pool().query(
    `SELECT id, org_name, status, answers_enc, updated_at, submitted_at FROM responses
     WHERE token_hash = $1 AND status <> 'revoked' AND expires_at > now()`,
    [hashToken(token)],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    orgName: r.org_name,
    status: r.status,
    answers: r.answers_enc ? (decryptJson(r.answers_enc, r.id) as SurveyAnswers) : {},
    updatedAt: r.updated_at.toISOString(),
    submittedAt: r.submitted_at ? r.submitted_at.toISOString() : null,
  };
}

// Both writes only touch in-progress rows, so a submitted response cannot change.
export async function saveAnswers(id: string, answers: SurveyAnswers): Promise<boolean> {
  const { rowCount } = await pool().query(
    `UPDATE responses SET answers_enc = $2, updated_at = now()
     WHERE id = $1 AND status = 'in_progress' AND expires_at > now()`,
    [id, encryptJson(answers, id)],
  );
  return rowCount === 1;
}

export async function submitAnswers(id: string, answers: SurveyAnswers): Promise<boolean> {
  const { rowCount } = await pool().query(
    `UPDATE responses SET answers_enc = $2, status = 'submitted', submitted_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'in_progress' AND expires_at > now()`,
    [id, encryptJson(answers, id)],
  );
  return rowCount === 1;
}
