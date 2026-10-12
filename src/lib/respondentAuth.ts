import { json, tooMany } from "./api";
import { isSameOrigin } from "./cookies";
import { clientIp, rateLimit } from "./rateLimit";
import { readSession, type Session } from "./sessions";

export const notSignedIn = () => json({ error: "Not signed in" }, 401);

// Every respondent API route starts here. Returns the session, or a Response to send back.
export async function requireRespondent(req: Request): Promise<Session | Response> {
  if (!rateLimit(`api:${clientIp(req)}`, 120, 60_000)) return tooMany();
  if (req.method !== "GET" && !isSameOrigin(req)) return json({ error: "Not allowed" }, 403);
  const session = await readSession(req);
  return session ?? notSignedIn();
}
