# Brief: Respondent sign-in through Okta self-service registration

**Business context:** IT requires respondents to authenticate with Okta. Respondents are outside provider organizations reached through one generic link, and we don't know in advance who will respond, so we can't create their Okta accounts ahead of time. Okta self-service registration lets each respondent create their own account the first time they visit, with an email code, the same way the current sign-in already works.

**Goal:** Replace the app's own email-code sign-in with Okta (OIDC). Okta creates the account, verifies the email, and sends the codes. The app keeps everything after sign-in: its own sessions, one response per email, the NPI start step, and admin "change owner email".

**Flow:**
1. Respondent opens the survey link. The app redirects to the Okta-hosted sign-in page.
2. First visit: they click "Sign up", enter email and name, and verify the email with a code. Okta puts them in a "Survey respondents" group.
3. Return visits: enter email, get a code, done.
4. Okta redirects back to `/auth/callback`. The app checks the ID token, requires `email_verified = true`, and creates its existing server-side session keyed by the email's lookup hash.
5. From here the app behaves as it does today: first time asks for org name and NPI, returning goes straight to the response.
6. "Save and exit" ends the app session and also signs out of Okta, so the next person on a shared computer isn't signed straight back in.

**What IT sets up (Okta Identity Engine):**
- An OIDC web app integration (authorization code with PKCE, client secret). Sign-in redirect URI `https://<host>/auth/callback`, sign-out redirect URI `https://<host>/`.
- A profile enrollment (self-service registration) policy attached to this app only. Email verification required. Password-optional sign-up if available (Okta marks it Early Access). Assign new users to a "Survey respondents" group.
- Assign the app to that group only. An authentication policy for the app that accepts an email code.
- Keep respondents off other apps and the Okta dashboard.
- Optional: custom email domain so Okta's emails come from our domain. Optional: registration inline hook if IT wants to gate sign-up (for example an access code from the invitation email).

**What the app needs from IT:** issuer URL, client ID, client secret. Set as `OKTA_ISSUER`, `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`, plus `OKTA_REDIRECT_URI` and `OKTA_POST_LOGOUT_REDIRECT_URI`.

**Done when:**
- [ ] Unsigned visitors to `/` and the respondent API are sent to Okta (pages) or get `401` (API).
- [ ] The callback checks `state`, `nonce`, PKCE, issuer, audience, expiry, and signature, and rejects tokens where `email_verified` is not true.
- [ ] A successful callback creates a new app session (fresh ID, same cookie rules as today) and audits `signin.succeeded`. A failed one audits `signin.failed` and shows a plain error with a "try again" link.
- [ ] First sign-in leads to the org name and NPI step; returning sign-in opens the existing response; submitted responses open read-only.
- [ ] "Save and exit" ends the app session and does an Okta sign-out (RP-initiated logout) back to `/`.
- [ ] A save that gets `401` keeps the typed answers, sends the respondent through Okta, and finishes the save on return.
- [ ] Admin "change owner email" still works: the new owner signs up in Okta with their own address and lands on the response.
- [ ] Works end to end locally against a mock OIDC provider in docker-compose, with no Okta details needed.
- [ ] `/api/auth/code`, `/api/auth/verify`, the `signin_codes` table, and the app's code-sending path are removed (or switched off behind config until Okta goes live).
- [ ] No tokens, codes, session IDs, or email addresses in logs or the audit table.

**Don't change:** survey content and pages; response data model apart from sign-in fields; NPI check and duplicate-NPI flag; one response per email; app session table and cookie rules; admin sign-in (admin SSO is separate work); close-date and read-only-after-submit rules.

**Constraints:**
- Okta-hosted sign-in page (redirect), not an embedded widget.
- Server-side OIDC client with the secret kept server-side. One well-maintained OIDC library at most (for example `openid-client`); no Okta admin API token in the app.
- Responses keyed by verified email (lowercased, trimmed), so "change owner email" keeps working. Store Okta `sub` for audit only.
- Same-origin checks on state-changing requests stay.
- Mock OIDC provider for local and CI; real Okta only through config.

**Out of scope:** pre-loading users from the distribution list; a separate Okta tenant or Auth0; social or partner-org sign-in; admin SSO; Okta account cleanup at teardown (IT task, but listed in Open questions).

**Open questions:**
- Which Okta product does IT run (Workforce on Identity Engine or Classic)? Self-service registration as described needs Identity Engine.
- Is password-optional sign-up available to us? If not, respondents must set a password. Is that acceptable?
- Is an email code enough as the only factor, or does IT require MFA (for example Okta Verify)?
- How are a few hundred outside users licensed in our Okta org, and does IT accept them there?
- Does "Keep me signed in for 14 days" stay (app session) or move to Okta's session settings?
- Can Okta's emails come from our domain? If not, the invitation must name Okta's sender so codes aren't missed.
- Who deactivates and deletes respondent accounts at teardown, and when?

**Related:** [ADR-0003](../adr/0003-email-code-sign-in.md) and its [spec](../specs/0003-email-code-sign-in.md) (would be superseded by a new ADR for Okta); [IT requirements](../it-requirements.md) need 12 (Graph mailbox, no longer needed once Okta sends the codes).
