import { env, type Env } from "./env";
import { survey } from "./survey";

export type Mail = { to: string; subject: string; text: string };

type Fetch = typeof fetch;

// Microsoft Graph, client credentials. The app registration must be limited (Exchange RBAC for
// Applications or an application access policy) to sending as MAIL_FROM only.
export function graphSender(e: Env, f: Fetch = fetch) {
  let token: { value: string; until: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && token.until > Date.now()) return token.value;
    const res = await f(
      `https://login.microsoftonline.com/${e.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: e.GRAPH_CLIENT_ID!,
          client_secret: e.GRAPH_CLIENT_SECRET!,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    if (!res.ok) throw new Error(`graph token request failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, until: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  return async (m: Mail) => {
    const res = await f(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(e.MAIL_FROM!)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: m.subject,
            body: { contentType: "Text", content: m.text },
            toRecipients: [{ emailAddress: { address: m.to } }],
          },
          saveToSentItems: false,
        }),
      },
    );
    if (res.status !== 202) throw new Error(`graph sendMail failed: ${res.status}`);
  };
}

// Local docker-compose only: mail lands in the Mailpit inbox at http://localhost:8025.
export function mailpitSender(e: Env, f: Fetch = fetch) {
  return async (m: Mail) => {
    const res = await f(`${e.MAILPIT_URL}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: e.MAIL_FROM },
        To: [{ Email: m.to }],
        Subject: m.subject,
        Text: m.text,
      }),
    });
    if (!res.ok) throw new Error(`mailpit send failed: ${res.status}`);
  };
}

// Demo only: anyone who can read the logs can sign in as anyone.
export function logSender() {
  return async (m: Mail) => {
    console.log(`[mail:log] to=${m.to} subject=${m.subject}\n${m.text}`);
  };
}

let sender: ((m: Mail) => Promise<void>) | undefined;

export function sendMail(m: Mail): Promise<void> {
  if (!sender) {
    const e = env();
    sender =
      e.MAIL_TRANSPORT === "graph"
        ? graphSender(e)
        : e.MAIL_TRANSPORT === "mailpit"
          ? mailpitSender(e)
          : logSender();
  }
  return sender(m);
}

// Message text. Codes stay out of subjects (lock screens). Never put answers or figures in mail.

function returnLine(): string {
  const url = env().PUBLIC_URL;
  return url
    ? `go to ${url} and sign in with this email address`
    : "open the survey link from your invitation email and sign in with this email address";
}

function closesLine(): string {
  const closes = env().SURVEY_CLOSES_AT;
  return closes ? ` The survey closes on ${formatDate(closes)}.` : "";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function codeMail(to: string, code: string): Mail {
  return {
    to,
    subject: `Your ${survey.title} sign-in code`,
    text:
      `Your sign-in code is ${code}\n\n` +
      `It expires in 10 minutes. If you didn't ask for it, you can ignore this email.\n`,
  };
}

export function startedMail(to: string): Mail {
  return {
    to,
    subject: `You started the ${survey.title}`,
    text:
      `Your answers are saved as you go. To continue, ${returnLine()}.${closesLine()}\n\n` +
      `This email has no sign-in code in it. Each time you sign in, we'll send you a new one.\n`,
  };
}

export function submittedMail(to: string, orgName: string, submittedAt: Date): Mail {
  return {
    to,
    subject: `We received your ${survey.title}`,
    text:
      `We received the survey for ${orgName} on ${formatDate(submittedAt.toISOString())}. ` +
      `Thank you.\n\nTo view your answers, ${returnLine()}.${closesLine()}\n`,
  };
}
