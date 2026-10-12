# ADR-0003: Respondents sign in with a one-time code sent to their email

Status: Accepted (2026-10-12). Supersedes [ADR-0002](0002-token-link-credential.md). Detailed design: [spec](../specs/0003-email-code-sign-in.md).

## Scope

This covers **respondent sign-in only**: how a respondent proves who they are, starts a response, comes back to it over several sittings and devices, and what happens to their access when they submit and when the survey closes. The survey content and its pages already exist in the author's work environment and are out of scope. This repo's demo survey is just a stand-in to show the sign-in flow working.

The design is written so it can be rebuilt in another codebase: the rules, data, and endpoints below are the contract. This repo's code is a reference implementation.

## Context

ADR-0002 made a unique link the respondent's only credential. Two problems:

1. **People lose the link.** The real survey is long and takes several sittings, often on different days and devices. Every sitting depends on the respondent still having the link. Fallbacks (browser memory, copy/download/mailto buttons, admin reissue) only partly help.
2. **A bearer link is a weak story for sensitive data.** The survey collects health care provider organizations' costs and wages. Anyone holding the link can read and change the response, and links get forwarded and sit in browser history and shared inboxes.

Constraints:

- One generic URL goes to a distribution list of a couple thousand addresses. A few hundred responses are expected, arriving over time rather than all at once. We don't know in advance who at each organization will respond.
- No passwords and no credential management.
- The survey is hosted on the employer's domain. IT is asked to set up a no-reply address the app can send codes from. Beyond that, involve IT as little as possible.
- One response per organization. Respondents give their organization's NPI.
- No email domain blocking.
- Open 2 to 3 months, then the data is exported and resources are torn down.
- After submitting, respondents can view their answers but not change them.

## Decision

Respondents prove who they are with their work email plus a 6-digit code we email them. Their progress is saved on the server. Coming back, on any device, means opening the same URL and asking for a new code. There is no link or password to keep.

### Flow

1. **Enter email.** Open the generic URL, enter work email.
2. **Code sent.** The page says "We sent a code to [address]. It can take a minute. Check junk mail if it doesn't arrive." Any address can sign in, so this reveals nothing. Whether an address already has a response is only shown after the code is entered, which proves the person can read that inbox.
3. **Enter code.** Optional checkbox: "Keep me signed in on this device for 14 days" (off by default, with a note not to use it on a shared computer).
4. **First time:** enter organization name and NPI, then start. The response belongs to this email from now on.
   **Returning:** go straight to the response.
5. **During the survey:** the session keeps them signed in (see "Sessions"). "Save and exit" signs them out and says how to come back.
6. **Started email:** on first start, one plain email: "You started the survey. To continue, go to [URL] and sign in with this address. The survey closes on [date]." No code or secret in it, so forwarding it is harmless.
7. **Submit** locks the response. A confirmation email says it was received. **No answers or figures ever go in an email.**
8. **After submitting:** signing in still works and shows the response read-only.
9. **After the close date:** signing in still works until teardown. In-progress responses become read-only and can't be submitted.

### Codes

- 6 random digits from a secure random generator, valid 10 minutes, single use.
- Stored only as a keyed hash (HMAC-SHA256 with a server secret) tied to the email's lookup hash, never in plain text.
- 5 wrong guesses kill the code. Requesting a new code kills any older one.
- Rate limits: per email (5 codes per hour, 10 per day), per IP (20 code requests per hour), and an overall cap that stays under the sender's quota. Kept in the database, not in memory, so they survive restarts and work with more than one app instance.
- With those limits, someone who knows a respondent's address and keeps guessing gets at most 50 guesses a day out of a million possible codes, and every attempt sends the real respondent an email they didn't ask for.

### Sessions

- Random 256-bit session ID in a cookie: HttpOnly, Secure, SameSite=Strict, path `/`. Only its SHA-256 hash is stored, so a database leak doesn't hand out sessions, and sessions can be ended server-side.
- Default: ends after 2 hours idle or 12 hours total. With "keep me signed in": 14 days total. Ends on "Save and exit." All sessions stop being accepted after teardown, which deletes them anyway.
- A new session ID is issued at every sign-in. One that was set before sign-in is never reused.
- State-changing requests must also pass a same-origin check (Origin header matches the site), as the admin side does today.
- **Expiry mid-sitting doesn't lose typing.** If a save comes back "signed out," the page keeps what was typed, shows a sign-in box in place (email already filled in), and retries the save once a new code is entered. This needs a small hook in the survey page: on a 401 from save, open the sign-in box instead of failing.

### One response per organization

- The start step asks for organization name and NPI. The NPI is checked for format: 10 digits with a valid check digit (the standard Luhn check with the `80840` prefix). This catches typos, not fake numbers.
- Signing in finds the response by email. Each email owns at most one response.
- A second response with the same NPI is **allowed but flagged** on the admin page, so an admin can contact both people and revoke one. It isn't blocked: blocking would let anyone claim an organization's NPI first and lock out the real respondent, and would tell strangers which organizations have started.
- If the respondent leaves or hands off to a colleague, an admin uses **"change owner email"** after confirming by phone. The colleague then signs in with their own address. The old owner's sessions end.

### Data stored for sign-in

| Table | Holds | Never holds |
|-------|-------|-------------|
| `responses` (new columns) | owner email encrypted (AES-256-GCM), owner email lookup hash (HMAC of lowercased, trimmed address), NPI, version number | |
| `signin_codes` | email lookup hash, code hash, expiry, attempts used, used flag | the code, the email |
| `respondent_sessions` | session ID hash, response ID, created, last seen, expires, ended flag | the session ID |
| `rate_limits` | key (hashed email or IP), window start, count | raw email |
| `audit_log` (new events) | `signin.code_requested`, `signin.succeeded`, `signin.failed`, `session.ended`, `owner.changed`, with response ID where known | email, code, answers |

Admins see the decrypted owner email. The CSV export includes it so follow-up is possible after teardown. Expired codes and sessions are deleted by a cleanup that runs with each sign-in, so they don't pile up.

### Endpoints

| Method and path | Body | Result |
|----|----|----|
| `POST /api/auth/code` | `{ email }` | `202` when sent. `429` if this address or IP asked too often |
| `POST /api/auth/verify` | `{ email, code, remember }` | `200` with session cookie and `{ hasResponse, status }`, or `401` (same message for wrong, expired, used, or killed codes) |
| `POST /api/auth/signout` | none | `204`, ends the session, clears the cookie |
| `POST /api/responses` | `{ orgName, npi }` | `201` creates the signed-in email's response. `409` if this email already has one |
| `GET /api/responses/me`, `PUT ...`, `POST .../submit` | as today | Now authenticated by session cookie instead of the `Authorization` token. `PUT`/`submit` return `409` once submitted or after the close date |
| `POST /api/admin/responses/:id/owner` | `{ email }` | Admin only. Changes the owner and ends their sessions |

### Sending the email

The employer uses Microsoft 365, so the app sends with **Microsoft Graph `sendMail` from a no-reply mailbox** on the work domain. Sending sits behind one small "send email" function with a setting that picks the backend:

- `graph`: production. IT creates the mailbox and an app registration with the `Mail.Send` application permission, limited so it can send *only* as that mailbox (Exchange Online RBAC for Applications, or the older application access policy). The app uses a client secret IT provides. No extra packages: two HTTPS calls.
- `mailpit`: local docker-compose. Mail lands in a local Mailpit inbox, nothing real is sent.
- `log`: demo deployments with no mailbox. The code is written to the app's log so the flow can be shown. Never for real respondents, because anyone who can read the logs could sign in as anyone. The app prints a warning at startup when it's on.

Volume: a few hundred respondents, staggered, each signing in a handful of times, is a few thousand emails over the survey. That's well within Microsoft 365's per-mailbox limits (10,000 recipients a day, 30 messages a minute). No quota request should be needed.

**What we need from IT:** the no-reply mailbox, the app registration (tenant ID, client ID, client secret) limited to sending as that mailbox, and confirmation that SPF/DKIM cover the address (normally true for the main domain). The invitation email should name that address so respondents know to expect it.

### What goes away

Unique links, the token in the URL fragment, the link kept in browser storage, the copy/download/mailto buttons, admin "reissue link," and the 90-day expiry (replaced by the close date). Admin "revoke" stays.

## Alternatives considered

- **Do nothing (keep ADR-0002 links).** Pros: built, tested, no email. Cons: a long, multi-sitting survey makes lost links more likely, and the security rests on respondents guarding a link for weeks.
- **Improve the link flow only.** Force respondents to confirm they saved the link, or email it to them. Pros: smallest change. Cons: still a bearer secret, and an emailed link is a long-lived credential sitting in an inbox. Worse than a 10-minute code.
- **Email a magic sign-in link instead of a code.** Pros: one click. Cons: corporate email scanners often open links to check them, which can use up a single-use link before the person does. A typed code avoids that.
- **Our own domain and email service** (the previous revision). Pros: no IT involvement. Cons: an unfamiliar sender domain is more likely to be junked or look like phishing to provider organizations. Dropped now that the survey is on the work domain.
- **Microsoft Entra External ID (email one-time passcode).** Pros: Microsoft handles codes and sending. Cons: a separate directory tenant for IT to create and run, sign-in on a Microsoft-hosted page, more moving parts for a 3-month survey. Asks more of IT than one no-reply mailbox.
- **Sign in with Microsoft/Google.** Pros: no email sending. Cons: many provider organizations block staff from consenting to outside apps, and not everyone uses Microsoft 365 or Google.
- **Accounts with passwords.** Ruled out. It's the credential management we're trying to avoid.

## Consequences

Better:

- No link or password to keep. Any sitting on any device picks up the saved response.
- Access is tied to an inbox the respondent's organization controls (and usually protects with MFA), not to a forwardable link.
- Sessions expire and can be ended by us.
- A real contact for every response, and NPI-based duplicate flags.
- Admin reissue goes away. "Change owner email" is the only manual case.

Downsides we accept:

- **Depends on email delivery and on IT setting up the sender.** If codes are delayed or junked, people can't get in. Mitigated by the work domain's existing reputation, naming the sender in the invitation, and testing with a few provider addresses before launch.
- **We store email addresses (personal data).** Encrypted at rest, never logged, deleted at teardown, but present in the exported CSV.
- **Inbox access equals survey access.** Anyone who can read the respondent's email can sign in. The same trust most password resets rely on.
- **"Keep me signed in" on a shared computer** gives the next person access for up to 14 days. Off by default, with a warning.
- **Organization identity is self-reported.** The NPI check catches typos, and duplicates are flagged, not prevented.
- **Slightly more friction** when returning (one email round trip).
- **The survey page needs a small hook** to reopen sign-in on a 401 instead of losing typed answers.

## Implementation

The work survey is also Next.js and Postgres, so the sign-in code here is written to be copied across: the sign-in, session, mail, and NPI modules don't depend on this repo's demo survey.

1. `docs/adr-0003-email-code-sign-in`: this ADR accepted, ADR-0002 marked superseded, and the [spec](../specs/0003-email-code-sign-in.md).
2. `feat/email-code-sign-in`: the whole change in one branch, one commit per step (mail sender, sign-in and sessions, respondent flow, admin, docs). The respondent flow can't switch from links to sign-in halfway, so splitting it across PRs would leave the app broken in between.

## Related

- [ADR-0002: Unique link as respondent credential](0002-token-link-credential.md) (superseded by this)
- [Spec](../specs/0003-email-code-sign-in.md)
- [IT requirements](../it-requirements.md)
