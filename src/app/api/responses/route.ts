import { audit } from "@/lib/audit";
import { json, readJson, tooMany } from "@/lib/api";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { createResponse } from "@/lib/responses";
import { orgNameSchema } from "@/lib/survey";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ orgName: orgNameSchema });

// Start a survey: returns the respondent's unique token once. It is never retrievable again.
export async function POST(req: Request) {
  if (!rateLimit(`start:${clientIp(req)}`, 10, 3_600_000)) return tooMany();
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Organization name is required" }, 400);
  const { id, token } = await createResponse(parsed.data.orgName);
  await audit("response.created", id);
  return json({ token }, 201);
}
