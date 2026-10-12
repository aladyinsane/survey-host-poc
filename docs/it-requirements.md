# Provider survey app: what we need from IT

This describes a working proof of concept (POC), what it already does for security, and what we need IT to provide to run it in production. The POC is in this repo and can be deployed to Azure with one script. It is a concrete starting point to review, and it is open to changes.

## 1. What it is

A small web app (Next.js in a container, Postgres database) used to run provider surveys.

- **Respondents** (outside organizations) open one generic link and sign in with their work email and a 6-digit code emailed to them each time. Their answers are saved on the server, so they can stop and come back from any device until the survey closes. No accounts, no passwords, no links to keep. The design is in [ADR-0003](adr/0003-email-code-sign-in.md) and its [spec](specs/0003-email-code-sign-in.md).
- **Administrators** (internal staff) sign in to a separate page to see progress, spot duplicate organizations (same NPI), export results to CSV, and move a response to a new contact when a respondent leaves.

**Data sensitivity.** Respondents are health care provider organizations. They enter organization-level costs and wages: wages paid by staff type, net revenue, and net income. This is commercially sensitive. The personal data is the respondent's work email address (stored encrypted), and possibly wage figures for a staff type with only one or two employees, which can amount to one person's pay. We would like IT to confirm the data classification and whether any regulatory framework applies (see section 8).

## 2. Architecture

```mermaid
flowchart LR
  R[Respondent browser] -->|HTTPS 443| I[Public ingress, managed TLS]
  A[Admin browser] -->|HTTPS 443| I
  I --> C[Container: Next.js app, non-root, 1 replica]
  C -->|TLS, private network only| P[(Postgres Flexible Server, no public endpoint)]
  C --> L[Log Analytics]
  C -->|HTTPS, sign-in codes| G[Microsoft Graph: no-reply mailbox]
```

POC resources (all Azure, one resource group, defined in Terraform in `infra/`): Container Apps environment and app, Postgres Flexible Server (private access), container registry, virtual network with two subnets, private DNS zone, Log Analytics workspace, managed identity.

## 3. What we need from IT

| # | Need | Why | In the POC |
|---|------|-----|-----------|
| 1 | A place to run one container (Container Apps, App Service, AKS, or an existing standard) | Runs the app | Azure Container Apps |
| 2 | Inbound HTTPS 443 from the internet to that container only. HTTP 80 redirect to 443 | Respondents are external | Platform ingress, HTTP redirected |
| 3 | A DNS name and TLS certificate on an organization domain (for example survey.example.org) | Trust. Respondents should see our domain, not a cloud hostname | Free azurecontainerapps.io hostname, platform-managed cert |
| 4 | Postgres 16 with no public endpoint, TLS required, encryption at rest, backups | Stores responses | Flexible Server, private access, 7 day backups |
| 5 | A secret store for the app's secrets (database URL with its password, data encryption key, admin password hash, session secret, mail client secret) | The app needs them at start | Container Apps secrets. Terraform generates all except the admin password hash and the mail client secret, which the deployer supplies |
| 6 | Admin sign-in through our identity provider (Entra ID SSO) instead of the built-in shared password | Individual accountability, MFA, offboarding | Built-in single shared password (POC only) |
| 7 | Log retention, plus a way to read the app's audit table or ship it to a SIEM | Incident response | 30 days of container logs in Log Analytics. The app's admin page shows the latest 200 audit events. The full table sits in the private database |
| 8 | Backup and restore policy for the database, and a decision on retention of responses | Data lifecycle | 7 day platform backups, no restore tested |
| 9 | Optional: WAF or gateway in front, with request size limits and shared rate limiting | Defense in depth, and lets us run more than one replica | None |
| 10 | Image build, scanning and patching process for the container | Supply chain | CI scans an image built from each PR. The deployed image is built on the deployer's machine by `up.ps1`, from an unpinned `node:24-alpine` base, so it is not the exact image CI scanned |
| 11 | A least-privilege database role for the app (data changes only), with separate credentials for schema changes | Limits the damage from an app bug or injection | None. The app connects as the Postgres server admin account |
| 12 | A no-reply mailbox on our domain (for example no-reply@example.org) and a Microsoft Entra app registration with the Microsoft Graph `Mail.Send` application permission, limited to sending as that mailbox only (Exchange Online RBAC for Applications, or an application access policy). We need the tenant ID, client ID, and a client secret. SPF and DKIM must cover the address | Sign-in codes and the "started" and "submitted" notices. A few thousand emails over a 2 to 3 month survey, well within Microsoft 365 limits | Codes written to the container log (demo only) |

## 4. Security controls

| Control | How | Provided by | Status |
|---------|-----|-------------|--------|
| TLS in transit, HTTP redirected, HSTS | Platform ingress plus HSTS header | Platform, app | In POC |
| Database not reachable from the internet | Private subnet, no public endpoint, private DNS | Platform | In POC |
| Encryption at rest | Azure-managed on the database, plus app-level AES-256-GCM on every answer | Platform, app | In POC |
| Respondent sign-in | 6-digit one-time code emailed to the respondent, valid 10 minutes, single use, killed after 5 wrong guesses or when a new code is requested. Only a keyed hash (HMAC) of each code is stored | App | In POC |
| Sign-in rate limits | Per address: 5 codes an hour and 10 a day. Per IP: 20 code requests and 30 code checks an hour. Overall: 200 codes an hour. Kept in the database, so they survive restarts. At most 50 guesses a day against one address, out of 1,000,000 codes, and each one emails the real respondent | App | In POC |
| Respondent sessions | Random 256-bit session id in an HttpOnly, Secure, SameSite=Strict cookie; only its SHA-256 is stored, so sessions can be ended server-side. Ends after 2 hours idle or 12 hours total (14 days if the respondent ticks "keep me signed in"), on sign-out, and when an admin moves the response to a new owner. Same-origin check on every state-changing request | App | In POC |
| Submitted responses cannot change, nothing is deleted | Update statements only match in-progress rows, a CHECK constraint, and database triggers that reject edits to submitted rows, un-revoking, deleting responses, and changing or deleting audit rows | App | In POC (a database administrator can still drop the triggers) |
| Answers cannot be moved between records | Ciphertext is bound to its record id | App | In POC |
| Email addresses protected | Stored encrypted (AES-256-GCM, bound to the row) plus a keyed hash for lookups. Never written to logs or the audit table. No answers or figures are ever put in an email | App | In POC |
| Input validation | Schema validation on every endpoint, unknown fields rejected, 20 KB body limit (declared size checked first, then actual bytes) | App | In POC |
| Security headers | CSP, X-Content-Type-Options, Referrer-Policy no-referrer, Permissions-Policy, frame-ancestors none, no-store caching | App | In POC (CSP allows inline scripts, see section 6) |
| Admin authentication | Scrypt password hash, constant-time compare, per-IP and global login limits, signed HttpOnly SameSite=Strict cookie, 4 hour expiry | App | In POC, to be replaced by SSO |
| Admin CSRF protection | SameSite=Strict plus same-origin check on every state-changing request | App | In POC |
| Spreadsheet injection in export | Cells beginning with = + - @ are neutralized | App | In POC |
| Audit trail | Append-only table records code requested, sign-in succeeded and failed, sign-out, response created, saved, submitted, admin login, failed login, owner changed, revoke, export. Never holds answers, codes, session ids, or email addresses. Latest 200 events visible on the admin page | App | In POC |
| No destructive edits | Revoke and change owner change state and keep the row. Nothing is deleted | App | In POC |
| Secrets not in source control | Generated at deploy time, held in platform secrets and local Terraform state | Platform, process | In POC |
| Container hardening | Non-root user, npm and corepack removed from the runtime image, health probes | App | In POC |
| Dependency and image scanning | CI runs npm audit and Trivy on an image built from every PR, Dependabot weekly | Process | In POC (see need 10 for the deployed image) |
| Least privilege to pull images | Managed identity with AcrPull, registry admin user disabled | Platform | In POC |

## 5. How respondent sign-in works (and its limits)

Respondents sign in with their work email and a one-time code. There is nothing to keep between sittings: they open the same link, ask for a new code, and pick up where they left off on any device.

- Any address can ask for a code, because anyone on the distribution list may respond. Whether an address already has a response is only shown after the code is entered, which proves the person can read that inbox.
- Each address owns at most one live response. Respondents give their organization's NPI, which is checked for typos. A second response with the same NPI is allowed but flagged on the admin page, so an administrator can contact both people and revoke one. Blocking it would let anyone claim an organization's NPI first.
- If a respondent leaves or hands off, an administrator moves the response to a colleague's email after confirming by phone. The old owner is signed out.
- After the close date (`SURVEY_CLOSES_AT`), nobody can start, save, or submit. Respondents can still sign in to view and print their answers until the resources are torn down. Teardown deletes the database, its backups, the encryption key, and all email addresses.
- If a session ends mid-sitting, the page keeps what was typed and asks for a new code before saving it.

Downsides: anyone who can read a respondent's email can sign in as them (the same trust most password resets rely on). Codes depend on email delivery, so a delayed or junked email blocks sign-in. "Keep me signed in" on a shared computer gives the next person access for up to 14 days (it is off by default, with a warning). Organization identity is self-reported. These are discussed in `docs/adr/0003-email-code-sign-in.md`.

## 6. Known gaps in the POC (what production would add)

1. **Admin SSO and roles.** One shared password today. Stateless sessions cannot be revoked before they expire (4 hours). The audit table records no user identity or IP address, and a database administrator could edit it.
2. **General rate limiting is in memory, in one process.** Sign-in limits are kept in the database, but the general per-IP limit on the survey and admin APIs is in memory, so the app runs as exactly one replica. Production needs gateway-level or shared rate limiting before scaling out. The app trusts the last X-Forwarded-For entry, which is only correct behind exactly one proxy. That has not been checked against the live Container Apps ingress.
3. **Database certificate is not verified.** The connection is encrypted over a private network, but the server certificate is not checked. Production should verify it against the Azure CA bundle.
4. **CSP allows inline scripts.** Next.js needs them for hydration. A nonce-based policy is planned.
5. **Container Apps has no read-only root filesystem option.** Local compose enforces one. Another platform (AKS) could enforce it.
6. **Request size is limited inside the app only.** Oversized requests are rejected by declared length, but a body can still be streamed to the app first. A gateway or WAF should cap request size.
7. **No tested restore.** Backups exist at the platform level. Restore has not been exercised.
8. **Immutability guards can be removed by the database admin.** The triggers that protect submitted and revoked rows, and the audit table, are in the schema, and the app's database account (gap 12) has the rights to drop them.
9. **Secrets sit next to the data they protect.** Terraform state on the deployer's machine holds the data encryption key, database password, session secret, and mail client secret in plain text, and the platform secret store holds the same values. Anyone who can read either can decrypt the answers and email addresses, so app-level encryption mainly protects against a database-only leak. Production needs a remote, locked, access-controlled state backend, and ideally a key held in a vault that the database administrators cannot read.
10. **No survey builder, multi-survey support, or voiding a submitted response.** One demo survey is defined in code.
11. **Demo mail mode writes codes to the log.** Without need 12, the deployed POC uses `MAIL_TRANSPORT=log`, which puts sign-in codes in the container log. Anyone who can read the logs could sign in as anyone. The app prints a warning at startup in this mode. Real respondents need the Microsoft 365 sender.
12. **The app uses the database admin account.** There is no separate least-privilege role (need 11).
13. **Audit viewer is minimal.** The admin page shows the latest 200 events with no filtering, no user identity (one shared admin), and no IP address. Shipping rows to a SIEM needs private database access.
14. **No penetration test or formal threat review.** The checks done so far are code review and live testing of the flows.

## 7. Threats considered

| Threat | Mitigation | Residual risk |
|--------|-----------|---------------|
| Someone guesses a sign-in code | 1,000,000 possible codes, 5 guesses per code, 10 codes per address a day, per-IP limits. Every attempt emails the real respondent | Low (about 1 in 20,000 a day for a determined attacker who knows the address) |
| Database leak | Codes, session ids, and email lookups are hashed. Answers and email addresses are encrypted with a key held outside the database | Leak plus key theft exposes data |
| Respondent's inbox is compromised | Out of our control. Sessions are short by default, and an admin can move a response and end sessions | Same as any email-based recovery |
| Someone signs in and claims another organization | NPI check digit, duplicate NPI flag on the admin page, admin revoke | Self-reported identity; needs admin follow-up |
| Admin password guessing | Scrypt, rate limits, global limit | A determined attacker can lock the admin out for 10 minutes |
| Cross-site request forgery on admin | SameSite=Strict plus origin check | Low |
| Injection (SQL, CSV formula, XSS) | Parameterized queries, schema validation, CSV neutralization, CSP, React escaping | Low |
| Bot sends codes to many addresses (email bombing, cost) | Per-IP and overall code limits | Distributed abuse is not stopped without a WAF |
| Compromised dependency or image | Scanning in CI, minimal image, Dependabot | Zero-days |
| Insider with portal access | Platform RBAC (not designed in the POC) | Depends on IT access model |

## 8. Questions IT is likely to ask

- **What is the data classification, and does any regulation apply?** Organization-level costs and wages from health care providers, plus each respondent's work email. Not patient or health data as designed. Small staff groups can make a wage figure one person's pay. Please confirm with Compliance. The organization name and NPI are stored in plain text so administrators can find a response.
- **Why not user accounts?** To avoid creating and securing passwords for a short survey. Email one-time codes give each respondent a way back in from any device without a password, and the only thing we need from IT for it is the no-reply sender (need 12). The tradeoffs are in section 5.
- **Where is data stored and for how long?** In one Postgres database in the chosen Azure region. The survey closes on a set date (2 to 3 months after launch). The data is then exported and all resources, including the database and its backups, are deleted. The exported CSV includes contact emails and has to be stored under our data handling rules.
- **Who can see responses?** Anyone with admin access, and platform administrators with database and key access. The encryption key is in the platform secret store, so a platform administrator can read it.
- **Can we put this behind our WAF or API gateway?** Yes. The app is a normal HTTPS container. Doing so would remove gaps 2 and 6.
- **Can it run on our existing platform?** Yes. It needs one container, a Postgres 16 database, a few secrets (see need 5), and HTTPS ingress. Nothing in the app is Azure-specific. The Terraform is.
- **What happens when it is deleted?** `./scripts/down.ps1` destroys the database, the key, and everything else in the POC. Production would need an agreed retention and deletion process.

## 9. If IT cannot deliver in time

The same repo can host a real survey in our own Azure subscription:

Prerequisites: a laptop with Azure CLI, Terraform, Docker and Node; rights in the Azure subscription to create resources, role assignments and register resource providers; someone who owns the subscription and its cost (it bills hourly while it exists); and a plan for a custom domain, since the POC uses the free Azure hostname.

1. Deploy with `./scripts/up.ps1` and note the URL.
2. Restrict access with `-AllowedIp` while testing. To open it to the public, re-run `up.ps1` without that flag.
3. Keep the Terraform state file (`infra/terraform.tfstate`) safe. Losing it makes a clean teardown harder (`down.ps1` falls back to deleting the resource group).
4. Export the CSV from the admin page, and run `./scripts/down.ps1` when the survey closes.

Before using it for a real survey, close the gaps that matter most: admin access (1), database certificate verification (3), a tested backup (7), the Microsoft 365 sender instead of log mode (gap 11, need 12), a close date (`survey_closes_at`), and a custom domain (need 3). Share this document and the repo with IT so they can review it in parallel.

## 10. What was verified on a live deployment

The POC was deployed to Azure (East US 2) on 2026-10-01 with `up.ps1`, tested, then destroyed with `down.ps1`. That run used the earlier unique-link sign-in (ADR-0002). The email-code sign-in that replaced it (ADR-0003) has been tested end to end on a local stack with a local mail inbox (Mailpit), but not yet on a live deployment or with real Microsoft 365 sending.

- HTTPS works on the Azure hostname. HTTP returns a 301 redirect to HTTPS.
- The security headers listed in section 4, including HSTS, were present on responses from the live app.
- The full respondent flow worked end to end: start, save, resume, submit, and a rejected edit after submit. Admin sign-in, list, CSV export, and audit events worked. Unauthenticated admin calls returned 401, and a bad respondent token returned 404.
- The database reports public network access disabled, sits on a delegated private subnet, and its hostname does not resolve from the public internet.
- The container app ran as exactly one replica, took all four secrets from platform secrets (none appear in its environment settings), and the registry admin user was off.
- The container logs held no answers, organization names, or passwords.
- After `down.ps1`, the subscription's resource groups and resource count matched what they were before the deploy, with no leftover managed resource groups or soft-deleted workspaces.

Not verified live: the database contents (checked only locally), certificate details beyond the platform default, how the Container Apps ingress sets X-Forwarded-For (the rate limiter depends on it, see gap 2), behavior under load, and a restore from backup.

## 11. Reference

- Sign-in endpoints: `POST /api/auth/code`, `POST /api/auth/verify`, `POST /api/auth/signout`
- Respondent endpoints: `POST /api/responses`, `GET` and `PUT /api/responses/me`, `POST /api/responses/me/submit`
- Admin: `/admin`, `/api/admin/*`
- Health check: `GET /healthz` (returns `{"status":"ok"}`, touches nothing)
- Required settings: `DATABASE_URL`, `DATA_ENCRYPTION_KEY` (32 random bytes, base64), `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`
- Mail settings: `MAIL_TRANSPORT` (`graph`, `mailpit`, or `log`), `MAIL_FROM`, `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`. Optional: `PUBLIC_URL` (used in emails), `SURVEY_CLOSES_AT`
- Ports: inbound 443 (and 80 for redirect). The app listens on 3000 inside the platform. Outbound: app to Postgres 5432 on the private network, HTTPS 443 to `login.microsoftonline.com` and `graph.microsoft.com` for sending mail, registry pull at deploy.
