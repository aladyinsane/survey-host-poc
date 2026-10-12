# Spec: respondent sign-in with an emailed one-time code

From [ADR-0003](../adr/0003-email-code-sign-in.md) (accepted 2026-10-12). Detailed enough to build, or to port into another Next.js + Postgres app, without asking what was meant.

## Goal

Respondents sign in with their work email and a 6-digit code sent to it, so they can leave and come back to one saved response, from any device, until the survey closes. No links or passwords to keep.

## Context and constraints

- Next.js (App Router, route handlers) and Postgres 16+. Same stack as the author's work survey.
- **No new npm dependencies.** Node `crypto` for randomness, hashing, HMAC, HKDF, and AES-GCM. `fetch` for Microsoft Graph and Mailpit. `pg` and `zod` as already used.
- **No new secrets** beyond the mail settings. Keys for hashing emails and codes are derived from the existing `DATA_ENCRYPTION_KEY` with HKDF, each with its own label, so one key can't be used in place of another.
- Nothing secret or personal in logs or the audit table: no codes, session IDs, email addresses, or answers. The `log` mail backend is the one exception and is for demos only.
- Migrations are append-only. Shipped migrations are never edited.
- Rate limits for sign-in are kept in Postgres so they survive restarts and work across replicas. The existing in-memory limiter stays for the general per-IP API limit.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `DATA_ENCRYPTION_KEY` | yes (existing) | 32 bytes, base64. Encrypts answers and emails. HKDF source for the hashing keys |
| `MAIL_TRANSPORT` | no, default `log` | `graph`, `mailpit`, or `log` |
| `MAIL_FROM` | for `graph`, `mailpit` | The no-reply address, e.g. `no-reply@example.org` |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | for `graph` | App registration allowed to send only as `MAIL_FROM` |
| `MAILPIT_URL` | for `mailpit` | e.g. `http://mailpit:8025` |
| `PUBLIC_URL` | no | The survey's public address, used in emails. Never taken from the request's Host header, which an attacker controls. If unset, emails say "open the survey link from your invitation" instead |
| `SURVEY_CLOSES_AT` | no | ISO 8601 date-time. After it, nobody can start, save, or submit. Unset means never closes |

Startup validation rejects a `graph` or `mailpit` transport with its settings missing. With `log`, the app prints a warning at startup that codes go to the log.

## Derived keys

`HKDF-SHA256(ikm = DATA_ENCRYPTION_KEY bytes, salt = empty, info = label, length = 32)`:

| Label | Used for |
|---|---|
| `email-lookup-v1` | `emailHash = HMAC-SHA256(key, normalizedEmail)` |
| `signin-code-v1` | `codeHash = HMAC-SHA256(key, emailHash ‖ code)` |
| `rate-limit-ip-v1` | `ipHash = HMAC-SHA256(key, ip)`, so raw IPs aren't stored |

**Email normalization:** trim, Unicode NFC, lowercase. Validate with `z.email()`, at most 254 characters.

Session IDs are 32 random bytes (base64url, 43 characters). The database stores `SHA-256(sessionId)`, which needs no key because the ID is already random.

Encrypted values use the existing `encryptJson(value, aad)`: AES-256-GCM, with the AAD binding the ciphertext to its row: `owner:<responseId>` for owner emails and `session:<idHash hex>` for session emails.

## Data (migration `003_email_signin`)

```sql
-- Responses: owned by an email instead of a link.
ALTER TABLE responses
  ADD COLUMN owner_email_hash bytea CHECK (owner_email_hash IS NULL OR octet_length(owner_email_hash) = 32),
  ADD COLUMN owner_email_enc  bytea,
  ADD COLUMN npi              text CHECK (npi IS NULL OR npi ~ '^[0-9]{10}$'),
  ADD COLUMN version          integer NOT NULL DEFAULT 0;
ALTER TABLE responses ALTER COLUMN token_hash DROP NOT NULL;   -- kept only for pre-003 rows
ALTER TABLE responses ALTER COLUMN expires_at DROP NOT NULL, ALTER COLUMN expires_at DROP DEFAULT;

-- One live (not revoked) response per email per survey.
CREATE UNIQUE INDEX responses_one_per_owner ON responses (survey_id, owner_email_hash)
  WHERE status <> 'revoked' AND owner_email_hash IS NOT NULL;
CREATE INDEX responses_npi ON responses (survey_id, npi) WHERE status <> 'revoked';

-- One live code per email. Requesting a new code replaces the row, which kills the old code.
CREATE TABLE signin_codes (
  email_hash bytea PRIMARY KEY,
  code_hash  bytea NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE respondent_sessions (
  id_hash      bytea PRIMARY KEY,
  email_hash   bytea NOT NULL,
  email_enc    bytea NOT NULL,
  idle_seconds integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ended_at     timestamptz
);
CREATE INDEX respondent_sessions_email ON respondent_sessions (email_hash);

CREATE TABLE rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL
);
```

The migration also replaces `responses_guard()` so that, once submitted, `owner_email_hash`, `owner_email_enc`, and `npi` are frozen too (on top of what it already protects).

## Sign-in

### `POST /api/auth/code`  body `{ email }`

1. Origin check: the `Origin` header must match the host. Otherwise `403`.
2. Validate and normalize the email. Invalid gives `400 { error: "Enter a valid email address." }`.
3. Rate limits, in this order. The first one exceeded wins:

   | Key | Limit | Window | Response |
   |---|---|---|---|
   | `code:ip:<ipHash>` | 20 | 1 hour | `429` "Too many requests from your network. Try again later." |
   | `code:email:<emailHash>` | 5 | 1 hour | `429` "Too many codes requested for this address. Use the most recent code, or try again in an hour." |
   | `code:email-day:<emailHash>` | 10 | 24 hours | same as above, "try again tomorrow" |
   | `code:all` | 200 | 1 hour | `503` "We can't send codes right now. Try again in a few minutes." |

4. Generate the code: `crypto.randomInt(0, 1_000_000)`, padded to 6 digits.
5. Upsert `signin_codes (email_hash, code_hash, attempts = 0, expires_at = now() + 10 minutes)`.
6. Send the code email (below). If sending fails: delete the code row, log the failure (no address or code), and return `503` "We couldn't send the email. Try again in a few minutes."
7. Audit `signin.code_requested`, with the response ID if this email owns a live response.
8. `202 { ok: true }`.

Any address may request a code, since anyone on the list can start a response. So "code sent" reveals nothing about who has responded.

### `POST /api/auth/verify`  body `{ email, code, remember }`

1. Origin check, then validate: `code` must match `^[0-9]{6}$`, and `remember` is a boolean. Malformed gives `400`.
2. Rate limit `verify:ip:<ipHash>`: 30 per hour, counting every attempt. Over the limit gives `429`.
3. Count the attempt and fetch the code in one statement:
   `UPDATE signin_codes SET attempts = attempts + 1 WHERE email_hash = $1 AND expires_at > now() AND attempts < 5 RETURNING code_hash`
4. No row, or the hash doesn't match (compared with `timingSafeEqual`): audit `signin.failed` and return `401 { error: "That code is wrong or has expired. Check the latest email, or request a new code." }`. The same message is used for every reason.
5. Match: `DELETE FROM signin_codes WHERE email_hash = $1 AND code_hash = $2`. If this deletes 0 rows, a parallel request already used the code, so return `401`. This makes the code single use.
6. Create a session (below), set the cookie, audit `signin.succeeded` with the response ID if one exists, and return `200 { ok: true }`.

So each code allows 5 guesses. Each address can get 10 codes a day, which is 50 guesses a day out of 1,000,000.

### `POST /api/auth/signout`

Origin check. Ends the session if there is one (`ended_at = now()`), audits `session.ended`, clears the cookie, and returns `204`. Signing out without a session also returns `204`.

## Sessions

| | Default | "Keep me signed in" |
|---|---|---|
| Idle limit | 2 hours | 14 days |
| Total limit | 12 hours | 14 days |
| Cookie lifetime | Browser session (no `Max-Age`) | `Max-Age` 14 days |

- Cookie `respondent_session=<sessionId>; HttpOnly; SameSite=Strict; Path=/`, plus `; Secure` in production.
- A fresh ID is created at every sign-in. Any session cookie sent with the verify request is ignored and not reused.
- Every authenticated request checks the session and moves the idle clock forward in one statement:
  `UPDATE respondent_sessions SET last_seen_at = now() WHERE id_hash = $1 AND ended_at IS NULL AND expires_at > now() AND last_seen_at > now() - make_interval(secs => idle_seconds) RETURNING email_hash, email_enc`
- Respondent endpoints that change state (`POST`, `PUT`) also require the origin check.
- Ended and expired sessions get `401 { error: "Not signed in" }`, and nothing else is revealed.
- Admin "change owner email" ends every session for the old email.

## Housekeeping

At most once every 10 minutes per app process, on the next code request, delete:

- codes that expired more than a day ago
- sessions that ended or expired more than a day ago
- rate-limit rows whose window started more than 2 days ago

## Respondent API

All of these require a session. With no session they return `401`.

### `GET /api/responses/me`

```json
{
  "email": "pat@provider.org",
  "closesAt": "2027-01-15T23:59:00Z",
  "closed": false,
  "response": null
}
```

`closesAt` is `null` if no close date is set. `response` is `null` if this email has no live response. Otherwise:

```json
{
  "orgName": "Acme Care",
  "npi": "1234567893",
  "status": "in_progress",
  "answers": {},
  "version": 3,
  "updatedAt": "...",
  "submittedAt": null
}
```

Revoked responses are treated as absent, so the person can start again. The admin page flags the duplicate NPI if they do.

### `POST /api/responses`  body `{ orgName, npi }`

- Gives `403 { error: "The survey is closed." }` after the close date, and `409` if this email already has a live response. The unique index enforces this too, and a violation of it maps to `409`.
- `npi` must be 10 digits with a valid check digit (below). Otherwise `400 { error: "Enter your organization's 10-digit NPI." }`.
- Creates the response with `owner_email_hash`, `owner_email_enc`, and `npi`, audits `response.created`, and sends the "started" email. That email is best effort: a failure is logged but not returned to the respondent. Returns `201`.

### `PUT /api/responses/me`  body `{ answers, version }`

Saves a draft. Returns `404` with no live response, `403` if closed, and `409 { error, reason: "submitted" }` once submitted. If `version` doesn't match what's stored, it returns `409 { error, reason: "changed" }` (changed in another window or on another device). On success the version goes up by 1 and it returns `200 { version, updatedAt }`.

The update statement checks `status = 'in_progress' AND version = $v`, and the close date is checked in the same statement, so two parallel saves can't both win.

### `POST /api/responses/me/submit`  body `{ answers, version }`

Same rules, but uses the survey's "every field required" validation. Locks the response, audits `response.submitted`, sends the "submitted" email (best effort), and returns `200`.

## NPI check

10 digits. The last digit is a Luhn check digit computed over `80840` + the first 9 digits (the standard from the NPI rule). `1234567893` is valid and `1234567890` is not. This catches typos, not made-up numbers.

## Email

All plain text. Codes stay out of the subject line so they don't show on lock screens. No answers or figures ever go in an email.

| When | Subject | Body (essentials) |
|---|---|---|
| Code requested | `Your <survey title> sign-in code` | "Your sign-in code is 123456. It expires in 10 minutes. If you didn't ask for it, you can ignore this email." |
| Response started | `You started the <survey title>` | "To continue, go to <PUBLIC_URL> and sign in with this email address. The survey closes on <date>." |
| Response submitted | `We received your <survey title>` | "We received the survey for <org name> on <date>. You can sign in at <PUBLIC_URL> to view your answers until the survey closes." |

### Graph backend

1. Get a token from `POST https://login.microsoftonline.com/{GRAPH_TENANT_ID}/oauth2/v2.0/token` (form body: `client_id`, `client_secret`, `scope=https://graph.microsoft.com/.default`, `grant_type=client_credentials`). Cache it until 60 seconds before `expires_in`.
2. Send with `POST https://graph.microsoft.com/v1.0/users/{MAIL_FROM}/sendMail`. Body: `{ message: { subject, body: { contentType: "Text", content }, toRecipients: [{ emailAddress: { address } }] }, saveToSentItems: false }`. It returns `202`. Anything else throws.

IT setup: an app registration with the `Mail.Send` **application** permission (admin consent), limited to the no-reply mailbox (Exchange Online RBAC for Applications, or `New-ApplicationAccessPolicy`).

### Mailpit backend

`POST {MAILPIT_URL}/api/v1/send` with `{ From: { Email }, To: [{ Email }], Subject, Text }`.

### Log backend

Writes `[mail:log] to=<address> subject=<subject>` plus the body to stdout. Demo only.

## Respondent pages

- **`/`**: if already signed in, go to `/r`. Otherwise show the sign-in box.
- **Sign-in box** (one shared component):
  1. Email field and a "Send code" button.
  2. "We sent a code to x." Then a 6-digit field (`inputmode="numeric"`, `autocomplete="one-time-code"`), a "Keep me signed in on this device for 14 days" checkbox (off by default, with "Don't use this on a shared computer"), "Send a new code", and "Use a different email".
  3. The error message from the API is shown as is.
- **`/r`**:
  - **Not signed in:** go to `/`.
  - **Signed in, no response:** start form with organization name and NPI. The NPI is checked in the browser as well as on the server.
  - **In progress:** the survey. The top shows "Signed in as x" and a "Save and exit" button (saves, signs out, goes to `/` with "Saved. To come back, open this page and sign in with the same email.").
  - **Submitted or closed:** answers shown read-only with "Print or save as PDF" (`window.print()`, buttons hidden in print).
- **Session ends mid-sitting:** a save or submit that gets `401` keeps what was typed and opens the sign-in box in place, with the email filled in and locked. After sign-in, the save or submit is retried automatically.
- **`409 changed`:** "These answers were changed in another window or on another device." Reloading discards unsaved edits, so the page says so before reloading.

## Admin

- **Response list:** adds owner email (decrypted), NPI, and a "Duplicate NPI" flag when more than one live response has the same NPI. The "Link expires" column is removed.
- **`POST /api/admin/responses/:id/owner`**  body `{ email }`:
  - Allowed on in-progress responses only. Otherwise `409`.
  - `409` if the new email already owns a live response.
  - Updates the owner hash and the encrypted email, ends all sessions for the old email, audits `admin.owner_changed`, returns `200`.
- **"New link" (reissue) is removed.** "Revoke" stays.
- **CSV export:** adds `owner_email` and `npi` columns.

## Tests and acceptance criteria

Unit tests (no database):

1. NPI: known valid and invalid numbers, wrong length, non-digits.
2. Email normalization, plus the hash being the same for `Pat@X.org ` and `pat@x.org`.
3. Derived keys differ from each other and from the data key. HMACs are deterministic.
4. Codes are always 6 digits. Code hashes depend on both the email and the code.
5. Cookie strings: attributes, `Secure` only in production, `Max-Age` only with remember.
6. Mail: the Graph backend requests a token once, caches it, and sends the right body. A non-202 throws. The Mailpit body is right. Env validation rejects a `graph` transport with settings missing.

Database tests (run when `TEST_DATABASE_URL` is set, and in CI with a Postgres service):

7. Request a code, verify it, and get a session. The same code fails a second time.
8. A wrong code 5 times kills the code, even if the right one is sent next.
9. A new code request kills the old code.
10. An expired code fails.
11. Rate limits: the 6th code request for an email in an hour is refused, and the window resets.
12. Sessions: valid, idle-expired, total-expired, ended by sign-out, and ended by an owner change.
13. One live response per email. A revoked response frees the email.
14. Save with a stale version gives `changed`. Save after submit is refused. Save after the close date is refused.
15. Changes to the owner or NPI of a submitted row are rejected by the database trigger.

End to end (run by hand on the local stack, and checked in the browser):

16. Sign in, start, save, and sign out. Sign in again on a fresh browser profile and the answers are there. Submit, then see the read-only view.
17. A session expired mid-sitting: what was typed survives re-sign-in and saves.
18. Admin: owner email and duplicate NPI are visible. Change owner and the old owner's session is gone. The CSV has the new columns.
19. Logs and audit table hold no codes, session IDs, or email addresses (except the `log` mail backend's own lines).

## Porting to the work app

Copy as is: `src/lib/keys.ts`, `email.ts`, `npi.ts`, `dbRateLimit.ts`, `signin.ts`, `sessions.ts`, `mail.ts`, `respondentAuth.ts`, the `/api/auth/*` routes, `src/app/SignIn.tsx`, and migration `003_email_signin` (adjusted to your table names).

Then, in your survey:

1. Make each survey API route call `requireRespondent(req)` and look up the response by `owner_email_hash`.
2. Send `version` with saves and handle `409 changed`.
3. On a `401` from a save, open `SignIn` in place and retry.
4. Add the NPI and org name start step if your survey doesn't already collect them up front.

## Out of scope

- Survey content, autosave, section progress, and contact fields: they live in the work survey.
- Admin SSO (IT doc gap 1).
- Sharing one response between several people from an organization (decided: one per organization).
- Blocking by email domain (decided: none).
- SMTP and other mail backends (Microsoft 365 confirmed).

## Open questions for the implementer

None at the time of writing. Flag anything that doesn't fit, rather than guessing.
