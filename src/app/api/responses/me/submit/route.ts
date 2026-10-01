import { audit } from "@/lib/audit";
import { authenticate, json, readJson } from "@/lib/api";
import { submitAnswers } from "@/lib/responses";
import { finalSchema } from "@/lib/survey";

export const dynamic = "force-dynamic";

// Final submit: every field is required, and the response locks.
export async function POST(req: Request) {
  const r = await authenticate(req);
  if (r instanceof Response) return r;
  if (r.status !== "in_progress") return json({ error: "Already submitted" }, 409);
  const parsed = finalSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Every question needs a valid answer" }, 400);
  if (!(await submitAnswers(r.id, parsed.data))) return json({ error: "Already submitted" }, 409);
  await audit("response.submitted", r.id);
  return json({ ok: true });
}
