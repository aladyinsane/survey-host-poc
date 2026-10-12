import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson } from "@/lib/api";
import { sendMail, startedMail } from "@/lib/mail";
import { isValidNpi } from "@/lib/npi";
import { requireRespondent } from "@/lib/respondentAuth";
import { createResponse, isClosed } from "@/lib/responses";
import { orgNameSchema } from "@/lib/survey";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  orgName: orgNameSchema,
  npi: z.string().trim().refine(isValidNpi),
});

// Start the signed-in address's response. One live response per address.
export async function POST(req: Request) {
  const s = await requireRespondent(req);
  if (s instanceof Response) return s;
  if (isClosed()) return json({ error: "The survey is closed." }, 403);
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    const npiBad = parsed.error.issues.some((i) => i.path[0] === "npi");
    return json(
      {
        error: npiBad
          ? "Enter your organization's 10-digit NPI."
          : "Enter your organization's name.",
      },
      400,
    );
  }
  const id = await createResponse({ email: s.email, emailHash: s.emailHash, ...parsed.data });
  if (!id) return json({ error: "You already have a survey in progress." }, 409);
  await audit("response.created", id);
  // Best effort: the response exists either way.
  await sendMail(startedMail(s.email)).catch((e) =>
    console.error("started email failed:", e instanceof Error ? e.message : "unknown error"),
  );
  return json({ ok: true }, 201);
}
