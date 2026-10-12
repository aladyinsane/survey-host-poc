import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson, tooMany } from "@/lib/api";
import { isSameOrigin } from "@/lib/cookies";
import { emailHash, emailSchema } from "@/lib/email";
import { clientIp } from "@/lib/rateLimit";
import { liveResponseId } from "@/lib/responses";
import { createSession } from "@/lib/sessions";
import { verifyAllowed, verifyCode } from "@/lib/signin";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  email: emailSchema,
  code: z.string().regex(/^[0-9]{6}$/),
  remember: z.boolean(),
});

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Not allowed" }, 403);
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Enter the 6-digit code from the email." }, 400);
  if (!(await verifyAllowed(clientIp(req)))) return tooMany();
  const { email, code, remember } = parsed.data;
  if (!(await verifyCode(email, code))) {
    await audit("signin.failed");
    return json(
      {
        error: "That code is wrong or has expired. Check the latest email, or request a new code.",
      },
      401,
    );
  }
  const cookie = await createSession(email, remember);
  await audit(
    "signin.succeeded",
    (await liveResponseId(emailHash(email))) ?? undefined,
    remember ? { remember } : undefined,
  );
  const res = json({ ok: true });
  res.headers.append("Set-Cookie", cookie);
  return res;
}
