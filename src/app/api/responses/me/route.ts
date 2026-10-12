import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson } from "@/lib/api";
import { requireRespondent } from "@/lib/respondentAuth";
import { closesAt, findByOwner, isClosed, saveAnswers } from "@/lib/responses";
import { draftSchema } from "@/lib/survey";
import { writeFailure } from "@/lib/writeFailure";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await requireRespondent(req);
  if (s instanceof Response) return s;
  const r = await findByOwner(s.emailHash);
  return json({
    email: s.email,
    closesAt: closesAt()?.toISOString() ?? null,
    closed: isClosed(),
    response: r && {
      orgName: r.orgName,
      npi: r.npi,
      status: r.status,
      answers: r.answers,
      version: r.version,
      updatedAt: r.updatedAt,
      submittedAt: r.submittedAt,
    },
  });
}

const bodySchema = z.strictObject({ answers: draftSchema, version: z.int().min(0) });

export async function PUT(req: Request) {
  const s = await requireRespondent(req);
  if (s instanceof Response) return s;
  const r = await findByOwner(s.emailHash);
  if (!r) return writeFailure("missing");
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Invalid answers" }, 400);
  const answers = Object.fromEntries(
    Object.entries(parsed.data.answers).map(([k, v]) => [k, v ?? null]),
  );
  const result = await saveAnswers(r.id, answers, parsed.data.version);
  if (!result.ok) return writeFailure(result.reason);
  await audit("response.saved", r.id);
  return json({ version: result.version, updatedAt: result.updatedAt });
}
