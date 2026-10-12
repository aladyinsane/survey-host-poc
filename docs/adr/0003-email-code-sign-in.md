# ADR-0003: Respondents sign in with a one-time code sent to their email

Status: Proposed (2026-10-12, revised same day with the author's answers). Would supersede [ADR-0002](0002-token-link-credential.md) once accepted.

## Context

ADR-0002 made a unique link the respondent's only credential. It works and is well hardened, but two problems remain:

1. **People lose the link.** The real survey is long and will take several sittings, often on different days and sometimes on different devices. Every one of those sittings depends on the respondent still having the link. The fallbacks (browser memory, copy/download/mailto buttons, admin reissue after a phone check) help, but browser memory only works on the same device, and reissue is manual work for us based on an organization name nobody verified.
2. **A bearer link is a weak story for sensitive data.** The survey collects health care provider organizations' costs and wages (net revenue, average/min/max wages by staff type). Anyone holding the link can read and change the response. Links get forwarded, sit in browser history, and land in shared inboxes.

Constraints:

- One generic URL goes to a large distribution list. We don't know in advance who at each organization will respond, so we can't pre-issue per-person links.
- No passwords. We don't want to store, reset, or lock out credentials.
- **Involve IT as little as possible.** Anything we can set up ourselves, in our own Azure subscription, beats anything that needs an IT ticket.
- **One response per organization.**
- **No email domain blocking.** Anyone on the list can respond from whatever address they use.
- **The survey is open 2 to 3 months.** Then the data is exported and every resource is torn down.
- **After submitting, respondents can view their answers but not change them.**

ADR-0002 assumed server-sent email was off the table. This proposal reverses that, using an email service we set up ourselves (see "Sending the email").

## Decision

Respondents prove who they are with their work email plus a 6-digit code we email them. Their progress is saved on our server as they go. Coming back, on any device, means opening the same generic URL and asking for a new code. There is no link or password to keep.

### Respondent flow

1. Open the generic URL. Enter work email.
2. Page always says "If that address can receive a code, we've sent one. Check your junk folder if it doesn't arrive in a minute." (Same message whether or not the address has a survey, so nobody can probe who has responded.)
3. Enter the code. Optional checkbox: "Keep me signed in on this device for 14 days" (off by default, with a note not to use it on shared computers).
4. First time: enter organization details and start. Returning: land on the first unfinished section.
5. Work through the survey over as many sittings as needed (see "Saving progress on a long survey").
6. On first start we send one plain email: "You started the survey. To continue, go to [generic URL] and sign in with this address. The survey closes on [date]." It holds no code or secret, so forwarding it is harmless.
7. Submit locks the response. A confirmation email says it was received. **No answers or figures ever go in an email.**
8. After submitting, signing in shows a read-only view of the answers with a "Print or save as PDF" button, since the site goes away when the survey closes.

### Saving progress on a long survey

Being able to resume doesn't help if work is lost between saves, so:

- **Autosave.** Each field saves a couple of seconds after the respondent stops typing, and again when they leave a section. A "Saved at 10:42" indicator is always visible. The "Save and exit" button saves, signs out, and tells them how to come back.
- **Section progress.** A section list shows complete / incomplete, so respondents can see where they are across sittings.
- **Sign-in expiry never loses typing.** If a session ends while the page is open (for example, after a long break to look up figures), unsaved answers stay on screen, a sign-in box appears in place, and the pending changes save as soon as they enter a new code.
- **Two devices at once.** Saves only send the fields that changed, and each save carries a version number. If the same response was changed in another window since the page loaded, the respondent is told to reload rather than silently overwriting it.
- **Warn on leaving** the page while a save is still pending.
- The request size limit (20 KB today) is raised to fit the real survey.

### How the code works

- 6 random digits, valid 10 minutes, single use.
- Stored only as a keyed hash (HMAC with a server secret) tied to the email, never in plain text.
- 5 wrong guesses kill the code. Requesting a new code kills the old one.
- Rate limits per email address, per IP, and overall. This protects respondents from being spammed with codes and keeps us under our email sending quota. These counters live in Postgres, not in memory, so they survive restarts.

### Sessions

- Random 256-bit session ID in an HttpOnly, Secure, SameSite=Strict cookie. Only its hash is stored, in a `respondent_sessions` table, so sessions can be ended server-side.
- Default: ends after 2 hours idle or 12 hours total. With "keep me signed in": 14 days total. Either way it ends on "Save and exit," and every session ends when the survey closes.
- State-changing requests get the same same-origin check the admin side already has.

### One response per organization

- The start page asks for the organization name and, if one exists, a provider identifier (open question 2). Names are normalized (case, spacing, punctuation, "Inc"/"LLC") for comparison.
- A second start for the same organization is allowed, but the admin page flags it as a likely duplicate so an admin can contact both people and revoke one. We don't block it, because blocking would let anyone "claim" an organization first and lock out the real respondent, and would tell strangers which organizations have started.
- Each response has one owner email. If the respondent leaves or hands the survey to a colleague, an admin uses "change owner email" after confirming by phone. The new person then signs in with their own address.

### Survey open and close dates

- The fixed 90-day link expiry goes away. Instead, a configured close date (`SURVEY_CLOSES_AT`) applies to everyone.
- After the close date, in-progress responses become read-only and nobody can submit. Respondents can still sign in to view and print until teardown.
- Teardown (`down.ps1`) deletes the database, its backups, the encryption key, and all email addresses. The exported CSV becomes the only copy of the data. It includes contact emails so follow-up is possible, so it has to be stored per the employer's data handling rules.

### Data

- **What is personal data here.** The survey is about organizations, not individuals. The personal data is (a) the respondent's email address, and (b) possibly wage figures: a min/max or average for a staff type with one or two employees is effectively that person's pay. Both are covered by the controls below, and (b) goes in the IT doc as a known sensitivity.
- The owner email is stored encrypted (same AES-256-GCM as answers), plus a keyed hash of the lowercased address for lookups. A database leak alone exposes neither the addresses nor the answers.
- Admins see the decrypted contact email and the duplicate flags.
- The audit log adds `signin.code_sent`, `signin.succeeded`, `signin.failed`, `session.ended`. Like today, it never holds answers, codes, or email addresses (only response IDs).

### What goes away

Unique links, the token in the URL fragment, the link kept in browser storage, the copy/download/mailto buttons, admin "reissue link," and the 90-day expiry. Admin "revoke" stays.

### Sending the email (no IT needed)

The app sends codes through **Azure Communication Services Email**, created by our own Terraform in our own subscription, from a no-reply address on **a domain we own**.

- The free Azure-managed sender domain is capped at 10 emails per hour and can't be raised, so it is only good for testing. A real survey needs a custom domain.
- Buy a short, plain domain (about $10 to $20 a year), for example something like `providersurvey.org`. We add its DNS records ourselves (domain verification, SPF, DKIM, DMARC) in an Azure DNS zone. No IT ticket.
- The same domain gives the survey site a proper address (`survey.<domain>`) instead of `*.azurecontainerapps.io`, which closes need 3 in the IT doc without IT.
- The domain and its DNS zone live in a small separate resource group that `down.ps1` leaves alone, so verification and sender reputation survive a rebuild. A separate `down.ps1 -IncludeDomain` removes it at the end.
- Default sending quota on a custom domain is 100 emails per hour and 30 per minute, and it can be raised by request. Launch day is the risk (open question 1). The "keep me signed in" option and the 12-hour session also cut how many codes get sent.
- The distribution email itself (sent from your normal work address) should name the sender address respondents will see, so a code from an unfamiliar domain doesn't look like phishing.
- Before launch, send test codes to a handful of real provider-organization addresses to check they land in the inbox and not junk.
- Locally, email goes to a Mailpit container in docker-compose so nothing real is sent.

This removes the one thing in the earlier draft that needed IT (sending from the employer's domain). Using this for a real survey with provider financial data may still need sign-off from your employer. This design keeps that to a review, not a build request.

## Alternatives considered

- **Do nothing (keep ADR-0002 links).** Pros: built, tested, no email needed. Cons: the long survey makes the lost-link problem worse, not better, and the security story rests on respondents guarding a link across weeks.
- **Improve the link flow only.** Force respondents to confirm they saved the link, email the link to them, add a short resume code. Pros: smallest change. Cons: still a bearer secret. Emailing the link puts a long-lived credential in an inbox, which is worse than a 10-minute code.
- **Email a magic sign-in link instead of a code.** Pros: one click. Cons: corporate email scanners often open links to check them, which can use up single-use links before the person does. A typed code avoids that.
- **Send from the employer's domain.** Pros: most trusted sender, best deliverability. Cons: needs IT to add DNS records and approve sending. Can be switched to later by changing the sender domain, with no code change.
- **Microsoft Entra External ID (email one-time passcode) in our own subscription.** Pros: Microsoft sends the codes, so no domain or quota to manage. Cons: a separate directory tenant created by hand outside Terraform that teardown doesn't remove. Sign-in happens on a Microsoft-hosted page on another unfamiliar domain. More moving parts for a 3-month survey. Kept as the fallback if our own sending has deliverability trouble.
- **Sign in with Microsoft/Google.** Pros: no email sending. Cons: many provider organizations' IT blocks staff from consenting to outside apps, which would push the problem onto *their* IT. Not everyone uses Microsoft 365 or Google.
- **Accounts with passwords.** Ruled out. It's the credential management we're trying to avoid.

## Consequences

Better:

- No link or password to keep. Progress is saved on the server, so any sitting on any device picks up where the last one stopped.
- Access is tied to an inbox the respondent's own organization controls (and usually protects with MFA), not to a link that can be forwarded.
- Sessions expire and can be ended by us.
- We get a real contact for each response, which helps follow-up and duplicate cleanup.
- Admin reissue and its manual identity check go away. "Change owner email" is the only manual case.
- A clear end: close date, export, teardown, and all respondent data in Azure is gone.

Downsides we accept:

- **We now depend on email delivery.** Codes from a new domain can land in junk folders or be held by provider organizations' filters. Mitigated by SPF/DKIM/DMARC, naming the sender in the invitation, and testing before launch.
- **Sending quota on launch day.** 100 per hour unless raised. Needs a quota request ahead of time if the list is large.
- **Small running cost and one more thing to own:** a domain (about $10 to $20 a year) and email (fractions of a cent per message).
- **We store email addresses (personal data).** Encrypted at rest, never logged, deleted at teardown, but present in the exported CSV.
- **Inbox access equals survey access.** Anyone who can read the respondent's email can sign in. Same trust most password resets rely on.
- **"Keep me signed in" on a shared computer** gives the next user access for up to 14 days. Off by default, with a warning.
- **Organization identity is still self-reported.** Duplicates are flagged for an admin, not prevented.
- **Slightly more friction** when returning (one email round trip, unless "keep me signed in" was used).

## Implementation outline (once accepted)

One idea per PR, matching how the rest of the repo was built:

1. `docs/adr-0003`: this ADR accepted, ADR-0002 marked superseded.
2. `feat/domain-and-email`: separate Terraform for the domain's DNS zone and the Communication Services email resources (kept out of teardown), custom domain on the container app, and a small "send email" module with console, Mailpit, and Azure backends. `up.ps1` prints the DNS records to add at the registrar the first time.
3. `feat/code-sign-in`: tables for codes, sessions, and rate-limit counters; `POST /api/auth/code`, `POST /api/auth/verify`, `POST /api/auth/signout`; tests for code expiry, single use, attempt limits, no enumeration, rate limits, session expiry, and "keep me signed in."
4. `feat/respondent-sessions`: survey API moves from the `Authorization` token to the session cookie; owner email (encrypted plus lookup hash); close date replaces the 90-day expiry; token-link UI and storage removed. New migration (existing ones are never edited). The POC holds no real data, so existing demo rows can be revoked.
5. `feat/long-survey-saving`: field-level autosave with version check, saved indicator, section progress, re-sign-in without losing typed answers, leave-page warning, larger request limit, read-only submitted view with print.
6. `feat/admin-owner-email`: contact email, duplicate-organization flags, "change owner email" replaces "reissue," new audit events in the viewer, contact email in the CSV export.
7. `docs/it-handoff-update`: IT doc rewritten for the new model (credential, personal data, email sending, close-and-teardown lifecycle), README demo script, then a live deploy and teardown to verify, including inbox-delivery tests.

## Open questions

1. **About how many organizations are on the distribution list, and how many do you expect to respond?** This decides whether the default 100 emails per hour is enough on launch day or we request more ahead of time.
2. **Do provider organizations have an ID you could ask for on the start page** (NPI, state license or provider number, or an ID from your own records)? It makes duplicate detection much more reliable than comparing names.
3. **Are you OK buying a domain** for the survey (site address and code sender), registered to you and paid from your subscription?
4. **Besides email, do you want to collect a contact name, title, or phone number** for each response? This affects what goes in the export and the personal data note.

## Related

- [ADR-0002: Unique link as respondent credential](0002-token-link-credential.md) (superseded by this, once accepted)
- [IT requirements](../it-requirements.md), especially sections 5 and 6 (admin SSO, gap 1, is separate and still needed)
- [Azure Communication Services service limits](https://learn.microsoft.com/en-us/azure/communication-services/concepts/service-limits)
