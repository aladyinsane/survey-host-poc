import { json } from "./api";
import type { WriteResult } from "./responses";

type Reason = Extract<WriteResult, { ok: false }>["reason"];

const failures: Record<Reason, [number, string]> = {
  missing: [404, "No survey in progress."],
  closed: [403, "The survey is closed."],
  submitted: [409, "This survey has already been submitted."],
  changed: [409, "These answers were changed in another window or on another device."],
};

export function writeFailure(reason: Reason): Response {
  const [status, error] = failures[reason];
  return json({ error, reason }, status);
}
