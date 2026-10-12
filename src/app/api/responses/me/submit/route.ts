import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson } from "@/lib/api";
import { sendMail, submittedMail } from "@/lib/mail";
import { requireRespondent } from "@/lib/respondentAuth";
import { findByOwner, submitAnswers } from "@/lib/responses";
import { finalSchema } from "@/lib/survey";
import { writeFailure } from "@/lib/writeFailure";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ answers: finalSchema, version: z.int().min(0) });

// Final submit: every field is required, and the response locks.
export async function POST(req: Request) {
  const s = await requireRespondent(req);
  if (s instanceof Response) return s;
  const r = await findByOwner(s.emailHash);
  if (!r) return writeFailure("missing");
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Every question needs a valid answer" }, 400);
  const result = await submitAnswers(r.id, parsed.data.answers, parsed.data.version);
  if (!result.ok) return writeFailure(result.reason);
  await audit("response.submitted", r.id);
  await sendMail(submittedMail(s.email, r.orgName, new Date(result.submittedAt!))).catch((e) =>
    console.error("submitted email failed:", e instanceof Error ? e.message : "unknown error"),
  );
  return json({ ok: true, submittedAt: result.submittedAt });
}
