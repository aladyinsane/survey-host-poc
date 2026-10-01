import { audit } from "@/lib/audit";
import { authenticate, json, readJson } from "@/lib/api";
import { saveAnswers } from "@/lib/responses";
import { draftSchema } from "@/lib/survey";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const r = await authenticate(req);
  if (r instanceof Response) return r;
  return json({
    orgName: r.orgName,
    status: r.status,
    answers: r.answers,
    updatedAt: r.updatedAt,
    submittedAt: r.submittedAt,
  });
}

export async function PUT(req: Request) {
  const r = await authenticate(req);
  if (r instanceof Response) return r;
  if (r.status !== "in_progress") return json({ error: "Already submitted" }, 409);
  const parsed = draftSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid answers" }, 400);
  const answers = Object.fromEntries(Object.entries(parsed.data).map(([k, v]) => [k, v ?? null]));
  if (!(await saveAnswers(r.id, answers))) return json({ error: "Already submitted" }, 409);
  await audit("response.saved", r.id);
  return json({ ok: true });
}
