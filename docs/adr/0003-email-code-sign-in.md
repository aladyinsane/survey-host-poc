# ADR-0003: Respondents sign in with a one-time code sent to their email

Status: Proposed (2026-10-12). Would supersede [ADR-0002](0002-token-link-credential.md) once accepted.

## Context

ADR-0002 made a unique link the respondent's only credential. It works and is well hardened, but two problems remain:

1. **People lose the link.** The whole save-and-resume promise depends on respondents noticing an instruction to save a link, and then keeping it. Many won't. The fallbacks (browser memory, copy/download/mailto buttons, admin reissue after a phone check) help, but the first one only works on the same device, and the last one is manual work for us and is based on an organization name nobody verified.
2. **A bearer link is a weak story for sensitive data.** The survey collects PII and organization financials (net revenue, average/min/max wages by staff type). Anyone holding the link can read and change the response. Links get forwarded, sit in browser history, and land in shared inboxes. IT will reasonably ask "how do you know who is on the other end?" and the honest answer today is "we don't."

Constraints that still hold:

- One generic URL goes to a large distribution list. We don't know in advance who at each organization will respond, so we can't pre-issue per-person links.
- No passwords. We don't want to store, reset, or lock out credentials, and IT won't want us to.
- Respondents should be able to resume from a different device.

ADR-0002 assumed IT would not approve server-sent email. This proposal depends on revisiting that, so it is the first open question below.

## Decision

Respondents prove who they are by entering their work email and then a 6-digit code we email to them. No password, nothing to save, works on any device.

### Respondent flow

1. Open the generic URL. Enter work email.
2. Page always says "If that address can receive a code, we've sent one." (Same message whether or not the address has a survey, so nobody can probe which organizations have responded.)
3. Enter the code. The app starts a session (a cookie, not a link).
4. First time: enter organization name and start. Returning: go straight to the in-progress survey.
5. Answers autosave a few seconds after each change. The "Save and exit" button just signs out and says: "To come back, open [generic URL] and enter your email."
6. On first start we send one plain email: "You started the survey. To continue later, go to [generic URL] and sign in with this address." It holds no code or secret, so forwarding it is harmless.
7. Submit locks the response. A confirmation email says it was received. **No answers or figures ever go in an email.**

Losing access is no longer possible in normal use: a respondent who comes back days later on a new laptop just asks for a new code.

### How the code works

- 6 random digits, valid 10 minutes, single use.
- Stored only as a keyed hash (HMAC with a server secret) tied to the email, never in plain text.
- 5 wrong guesses kill the code. Requesting a new code kills the old one.
- Rate limits per email address, per IP, and overall (protects respondents from being spammed with codes and caps our email cost). These counters live in Postgres, not in memory, so they survive restarts and work with more than one replica.

### Sessions

- Random 256-bit session ID in an HttpOnly, Secure, SameSite=Strict cookie. Only its hash is stored, in a `respondent_sessions` table, so sessions can be ended server-side.
- Ends after 30 minutes idle or 12 hours total, and on "Save and exit." Then the respondent signs in again with a fresh code.
- State-changing requests get the same same-origin check the admin side already has.

### Data

- A response belongs to the email that started it. The email is PII, so it is stored encrypted (same AES-256-GCM as answers), plus a keyed hash of the lowercased address for lookups. A database leak alone exposes neither the addresses nor the answers.
- Admins see the decrypted contact email so they can follow up.
- Audit log adds `signin.code_sent`, `signin.succeeded`, `signin.failed`, `session.ended`. Like today, it never holds answers, codes, or email addresses (only response IDs).

### What goes away

Unique links, the token in the URL fragment, the link kept in browser storage, the copy/download/mailto buttons, and admin "reissue link." Admin "revoke" stays. Reissue is replaced by "change owner email" (for when the respondent leaves their organization), still gated by an out-of-band check.

### Two ways to send the code (IT chooses)

- **A. The app sends the code itself (proposed for the POC).** Email goes out through Azure Communication Services Email (or IT's existing mail relay) from a no-reply address on our domain. Self-contained, about a week of work, everything testable in this repo. Locally, email goes to a Mailpit container in docker-compose so nothing real is sent.
- **B. IT's identity service sends it.** Microsoft Entra External ID has the same email one-time passcode sign-in built in. The app would just accept a standard sign-in token, and IT owns the whole credential side. Best answer to "we don't want you handling identity," but it needs IT to set up a tenant and app registration, so it depends on their timeline.

The app code will keep sign-in behind one small module so moving from A to B later only changes that module, not the survey flow.

## Alternatives considered

- **Do nothing (keep ADR-0002 links).** Pros: built, tested, no email needed. Cons: both problems in Context remain. Lost links mean duplicate responses and manual admin work, and the security story rests on respondents guarding a link.
- **Improve the link flow only.** Make respondents confirm they saved the link before continuing, email the link to them, add a short "resume code." Pros: smallest change. Cons: still a bearer secret. Emailing the link puts a long-lived credential in an inbox, which is worse than a 10-minute code. A short resume code is guessable unless paired with something else.
- **Email a magic sign-in link instead of a code.** Pros: one click. Cons: corporate email scanners often "click" links to check them, which can burn single-use links before the person does. Links also get forwarded. A typed code avoids both. (We could add a link later if testing shows codes are a pain.)
- **Sign in with Microsoft/Google (social login).** Pros: no email sending, strong if the org has MFA. Cons: not every respondent org uses Microsoft 365 or Google Workspace, and personal accounts add nothing about the organization. Option B above can offer this alongside email codes if IT wants it.
- **Accounts with passwords.** Ruled out. It's the credential management we're trying to avoid.

## Consequences

Better:

- Nothing for respondents to save, so nothing to lose. Works on any device.
- Access is tied to an inbox the respondent's own organization controls (and usually protects with MFA), not to a link that can be forwarded.
- Sessions expire and can be ended by us. A stolen session is useful for at most 12 hours.
- We get a real contact for each response, which makes follow-up and data-quality checks easier.
- Admin reissue, its manual identity check, and its unverified-organization-name weakness go away.

Downsides we accept:

- **New dependency on email delivery.** Codes can be delayed or quarantined by corporate spam filters. Needs a sending domain with SPF, DKIM, and DMARC set up, and a note on the start page about checking junk mail. Needs IT approval.
- **We now store email addresses (PII).** Encrypted at rest and never logged, but it adds to the data we're responsible for and must go in the retention decision.
- **Inbox access equals survey access.** Anyone who can read the respondent's email can sign in. This is the same trust most password resets rely on.
- **Self-reported organization name is still unverified.** An email domain is a hint, not proof. Optional fix: restrict sign-in to email domains from the distribution list (open question 4).
- **Slightly more friction** each time someone returns (one email round trip).
- **Small running cost** for email (fractions of a cent per message).

## Implementation outline (once accepted)

One idea per PR, matching how the rest of the repo was built:

1. `docs/adr-0003`: this ADR accepted, ADR-0002 marked superseded.
2. `feat/email-sender`: a small "send email" module with three backends (console for tests, Mailpit for local compose, Azure Communication Services for deploys). Terraform for the Communication Services resources.
3. `feat/code-sign-in`: tables for codes, sessions, and rate-limit counters; `POST /api/auth/code`, `POST /api/auth/verify`, `POST /api/auth/signout`; tests for code expiry, single use, attempt limits, no enumeration, rate limits, and session expiry.
4. `feat/respondent-sessions`: survey API switches from the `Authorization` token to the session cookie; responses get an owner email (encrypted plus lookup hash); autosave; token-link UI and storage removed. A new migration (existing ones are never edited). The POC holds no real data, so existing demo rows can simply be revoked.
5. `feat/admin-owner-email`: show contact email, "change owner email" replaces "reissue," new audit events in the viewer.
6. `docs/it-handoff-update`: IT doc rewritten for the new model (credential section, data classification now includes PII, email sending added to "what we need from IT"), README demo script updated, then a live deploy and teardown to verify.

## Open questions

1. **Will IT let the app send email** from a no-reply address on our domain (option A), or would they rather we use Entra External ID (option B)? This decides the approach.
2. **What PII is collected, exactly?** Contact name, email, phone? Also: min/max wages for a staff type with only one or two people is effectively an individual's pay. IT and Compliance may classify that as personal data.
3. **One response per organization, or several people per organization?** For example finance fills in revenue and HR fills in wages. If several, we'd add "invite a colleague" (they sign in with their own email and share the response).
4. **Do we have the list of organizations or email domains on the distribution list?** If so, we could allow sign-in only from those domains. That blocks random submissions, but breaks for respondents who use Gmail or similar.
5. **How long is the survey open, and how long must data be kept afterward?** This replaces the fixed 90-day expiry and drives the purge plan for emails and answers.
6. **After submitting, should respondents be able to view their answers read-only, or reopen to correct them** (until the survey closes)? Today a submitted response is locked and can't be viewed.

## Related

- [ADR-0002: Unique link as respondent credential](0002-token-link-credential.md) (superseded by this, once accepted)
- [IT requirements](../it-requirements.md), especially sections 5 and 6 (admin SSO, gap 1, is separate and still needed)
