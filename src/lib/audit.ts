import { pool } from "./db";

// Event names and ids only. Never pass answers, tokens, or org names in `detail`.
export async function audit(event: string, responseId?: string, detail?: Record<string, unknown>) {
  await pool().query("INSERT INTO audit_log (event, response_id, detail) VALUES ($1, $2, $3)", [
    event,
    responseId ?? null,
    detail ? JSON.stringify(detail) : null,
  ]);
}
