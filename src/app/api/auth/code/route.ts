import { z } from "zod";
import { audit } from "@/lib/audit";
import { json, readJson } from "@/lib/api";
import { isSameOrigin } from "@/lib/cookies";
import { emailHash, emailSchema } from "@/lib/email";
import { clientIp } from "@/lib/rateLimit";
import { liveResponseId } from "@/lib/responses";
import { requestCode, type CodeRequestResult } from "@/lib/signin";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ email: emailSchema });

const failures: Record<Exclude<CodeRequestResult, "sent">, [number, string]> = {
  ip_limited: [429, "Too many requests from your network. Try again later."],
  email_limited: [
    429,
    "Too many codes requested for this address. Use the most recent code, or try again in an hour.",
  ],
  email_day_limited: [
    429,
    "Too many codes requested for this address today. Use the most recent code, or try again tomorrow.",
  ],
  busy: [503, "We can't send codes right now. Try again in a few minutes."],
  send_failed: [503, "We couldn't send the email. Try again in a few minutes."],
};

// Any address may ask for a code (anyone on the list can start a response), so "sent" reveals
// nothing about who has responded.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return json({ error: "Not allowed" }, 403);
  const parsed = bodySchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: "Enter a valid email address." }, 400);
  const { email } = parsed.data;
  const result = await requestCode(email, clientIp(req));
  if (result !== "sent") {
    await audit("signin.code_refused", undefined, { reason: result });
    const [status, error] = failures[result];
    return json({ error }, status);
  }
  await audit("signin.code_requested", (await liveResponseId(emailHash(email))) ?? undefined);
  return json({ ok: true }, 202);
}
