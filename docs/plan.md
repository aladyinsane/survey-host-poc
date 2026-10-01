# Survey hosting POC: plan

## Context

Lauren has a working Next.js survey prototype at work but IT has not approved an externally accessible production environment. Goal: a public, containerized POC in a new public GitHub repo (`survey-host-poc`) with real security controls, plus documentation she can hand to IT as "this is what I need". It also stays usable as a fallback launch option if IT does not deliver in time.

Surveys collect sensitive financial data (wages by staff type, net revenue). Respondents get one generic link, click "start", and receive a unique link that acts as their credential to save and resume.

## Decisions made

- **Cloud:** Azure (personal subscription now; same services IT already knows).
- **Compute:** Azure Container Apps (managed HTTPS, free `*.azurecontainerapps.io` hostname, scale to zero). No VM, no Caddy. Docker Compose is for local dev only.
- **Data:** Azure Database for PostgreSQL Flexible Server (Burstable B1ms, encrypted at rest by default, private to the app). Rough cost while up: ~$13/mo prorated hourly; Container Apps near $0 when idle. App-level encryption of answer fields on top.
- **Infra as code:** Terraform (azurerm provider) in `infra/`, since IT uses it. Local state file (gitignored) for the POC; IT would move it to a remote backend. Requires the `terraform` and `az` CLIs installed locally.
- **Rebuild/teardown:** `scripts/up.ps1` and `scripts/down.ps1` (thin wrappers: `terraform apply` into one resource group; `terraform destroy`). Optional dump of the DB before teardown. Data is wiped on teardown by default.
- **Secrets:** `.env` locally (gitignored, `.env.example` committed). In Azure, Container Apps secrets generated at deploy time. CI uses GitHub Actions variables/secrets, matching work practice.
- **App:** from scratch, minimal. Existing prototype not reused.

## Assumptions (say if wrong)

- Deploys come from your machine via `az` CLI for the POC; a GitHub Actions deploy workflow is optional later.
- Admin auth is a single admin account (password hash in a secret) with login rate limiting. IT would replace it with SSO/Entra ID.
- No email is sent by the server, now or planned.

## Respondent credential design

- "Start" creates a response row with a 256-bit random token (`crypto.randomBytes(32)`, base64url).
- DB stores only the SHA-256 hash of the token, so a DB leak does not leak working links.
- Token lives in the URL fragment (`/r#token`). Fragments are never sent to the server, proxies, or access logs. Client JS sends it in an `Authorization` header on API calls.
- `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on all response pages and API.
- Submitted responses lock; links can expire; admin can revoke.
- Rate limit "start" and token lookups per IP (in-app).

### Lost-link mitigation (no stored credential, no server email)

1. Browser remembers the link in localStorage; generic link offers "resume" on the same device.
2. Prominent copy button plus download of a small text file containing the link.
3. "Email this to myself" via a `mailto:` link (respondent's own mail client; server never sees the address).
4. Admin reissue: organization name is collected at start (non-secret). After out-of-band verification, admin rotates the token; the old link is dead.
   Known downsides (go in ADR-0002): forwarded links grant access, browser history/shared computers, duplicate responses if someone restarts instead of recovering.

## Security controls (each one gets a line in the IT doc)

- TLS only (Container Apps managed cert), HTTP redirected to HTTPS, HSTS header. Postgres reachable only from the app (VNet integration/private access, no public endpoint).
- Security headers: CSP, X-Content-Type-Options, frame-ancestors none, Referrer-Policy, Permissions-Policy.
- Encryption at rest: Azure-managed encryption for Postgres, plus app-level AES-256-GCM on answer payloads (key from secret, never in repo).
- App container runs non-root with a read-only filesystem; Next.js and base images pinned.
- Secrets: `.env` locally (gitignored, `.env.example` committed); Container Apps secrets in Azure, generated at deploy time.
- Input validation (zod) on every API route; parameterized queries only.
- Audit log table (response created, saved, submitted, admin login, admin export). No answer values in logs.
- Dependency and image scanning in CI (npm audit, Trivy). Dependabot.
- No SSH surface at all (PaaS). Log Analytics for container logs, no answer values or tokens logged.

## Branches / PRs (one idea each, you review and merge)

1. `docs/plan-and-adr` : this plan copied to `docs/plan.md`, README skeleton (see below), ADR-0001 (Azure Container Apps + Flexible Server + Terraform), ADR-0002 (token-link credential model with real downsides). Repo created on GitHub when this is ready to push.
2. `feat/app-skeleton` : Next.js (TypeScript), multi-stage non-root Dockerfile, `/healthz`, eslint/prettier, CI workflow.
3. `feat/db-and-respondent-flow` : Postgres schema/migrations, start/save/resume/submit API, token hashing, field encryption, lost-link UX, tiny demo survey (wages by staff type, net revenue), tests for token/crypto/validation.
4. `feat/admin` : admin login, response status view, CSV export, revoke and reissue link, audit log.
5. `feat/local-compose` : `docker-compose.yml` (app + postgres) for local dev, `.env.example`.
6. `feat/azure-infra` : Terraform (resource group scope: Container Apps env, app, Flexible Server, Log Analytics, ACR), security headers/rate limit config, `scripts/up.ps1`, `down.ps1`, `status.ps1`. Target: up in ~10 min, down in one command.
7. `docs/it-handoff` : the IT document and security controls matrix.
8. `feat/hardening-pass` : fixes from `/security-review` and a scan of the live deployment (headers, TLS, DB not publicly reachable).

## Root README (kept current in every PR that changes how things run)

A "Quick start" section at the very top, before any explanation:

1. **One-time setup:** install Docker, Terraform, Azure CLI; `az login`; copy `.env.example` to `.env`.
2. **Run locally:** `docker compose up`, with the URL to open.
3. **Build and deploy to Azure:** `./scripts/up.ps1`, what it prints (the public URL and admin login), expected time and cost per hour.
4. **Demo:** the generic link to share, the admin URL, a 5-step demo script.
5. **Tear down:** `./scripts/down.ps1` (optional `-Backup` first), and how to confirm nothing is still billing.
   Below that: architecture, security summary, link to `docs/it-requirements.md`.

## IT handoff doc (`docs/it-requirements.md`)

Plain-language: what the app is, data sensitivity, architecture diagram, what we need from IT (a container host such as Container Apps, public DNS name and TLS cert, ports 80/443 inbound only, a managed Postgres or encrypted volume, secrets storage, log retention, backup policy, WAF if they require one), the security controls matrix above mapped to who provides each (app vs platform), data flow, threat model in one page, and open questions IT is likely to ask with draft answers. Also a short "if IT says no" fallback section pointing at the Azure up/down scripts.

## Verification

- Local: `docker compose up`, walk through generic link -> start -> save -> close browser -> resume via unique link -> submit -> confirm locked; admin login, export, revoke.
- Unit tests: token generation/hash, field encryption round trip, input validation.
- Deployed: `scripts/up.ps1` end to end in Azure; confirm HTTPS on the azurecontainerapps.io URL, `curl -I` shows the headers, Postgres unreachable from the internet, DB inspected to confirm answers are ciphertext and tokens are hashes, no answers or tokens in container logs. Then `scripts/down.ps1` and confirm the resource group is gone (and `terraform state list` is empty) in the Azure portal.
- Per your workflow, features get checked in the running app, not just tests.

## What this deliberately pushes out

SSO, multi-tenant surveys, a survey builder UI, HA/autoscaling, WAF. All listed in the IT doc as "production would add".

## Needs from Lauren during implementation

`az login` on your machine with your personal subscription (I will not handle credentials), and approval to create the public GitHub repo.
