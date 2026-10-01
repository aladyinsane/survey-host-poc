# ADR-0002: A unique link is the respondent's credential

Status: Accepted (2026-09-30)

## Context
Respondents need to save and resume a survey without creating accounts or passwords. The server will not send email. Responses are sensitive, so a guessable or leaked identifier is a real risk.

## Decision
- Everyone gets the same generic link. Clicking "start" creates a response and a 256-bit random token, shown once as a unique link.
- The database stores only the SHA-256 hash of the token.
- The token travels in the URL fragment (`/r#token`) so it never reaches server logs, proxies, or Referer headers. The client sends it in an `Authorization` header.
- Responses are `no-store` and `Referrer-Policy: no-referrer`.
- Lost-link mitigations: remembered in the browser's localStorage, copy and download buttons, a client-side `mailto:` button, and admin reissue (rotate token) after out-of-band identity checks. No recovery question or password.
- Submitted responses lock. Admin can revoke or rotate a link.

## Alternatives considered
- **Admin-issued per-respondent links:** stronger identity, but the author wants one generic link, and it adds distribution work.
- **Account with email and password:** familiar, but means storing credentials, email, and password reset, which is out of scope for a POC.
- **Server emails the link:** not going to be approved by IT, so not planned.

## Consequences (downsides we accept)
- Anyone holding the link can read and edit the response until it is submitted. Forwarding it forwards access.
- Shared or public computers can leak it through browser history or localStorage.
- A lost link with no recovery means a restart, which can create duplicate responses. Admin reissue depends on a manual identity check against a self-reported organization name, which is not verified.
- Hashing protects against database leaks, not against someone who obtains the link itself.
- Answer payloads are also encrypted at the app level, so a database leak alone exposes neither links nor answers.
