# survey-host-poc

Proof of concept for hosting a containerized Next.js survey app (admin + respondent flow) with real security controls. Respondents use one generic link and sign in with their work email and a one-time code, so they can save and come back from any device ([ADR-0003](docs/adr/0003-email-code-sign-in.md)).

> **Status:** working POC. The respondent flow, admin page, Azure deploy and teardown, and the IT handoff doc are done, and a full deploy and teardown has been tested live. It is not production ready: see "Known gaps" in [docs/it-requirements.md](docs/it-requirements.md).

## Quick start

**Run locally (Docker)**

```bash
cp .env.example .env     # then fill in the secrets; the generator commands are in the file
node scripts/hash-admin-password.mjs   # prompts for an admin password, prints ADMIN_PASSWORD_HASH
docker compose up --build
```

Open http://localhost:3000 for respondents and http://localhost:3000/admin for the admin page (set `APP_PORT` in `.env` if 3000 is taken). Sign-in codes land in the local Mailpit inbox at http://localhost:8025; nothing is really sent. Stop and wipe local data with `docker compose down -v`.

Checks (also run in CI): `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`. Database tests (`*.db.test.ts`) also run when `TEST_DATABASE_URL` points at an empty Postgres database they can wipe, for example `TEST_DATABASE_URL=postgres://survey:survey@localhost:5432/survey_test npm test`.

**Deploy to Azure (public URL)**

One-time: install [Docker](https://www.docker.com/), [Terraform](https://developer.hashicorp.com/terraform/install) (1.9+), [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), and [Node](https://nodejs.org/). Then `az login`.

```powershell
./scripts/up.ps1        # asks for an admin password, then builds and deploys (about 15-20 min)
./scripts/status.ps1    # is it deployed? what is the URL? is it healthy?
./scripts/down.ps1      # destroys everything (about 25 min; asks you to type the resource group name)
```

- On the first run `up.ps1` asks for an admin password and saves only its hash in `infra/.admin-hash` (gitignored), so later runs do not ask again. Use `-ResetAdminPassword` to change it. The password itself is never stored.
- `up.ps1` prints the **respondent link** (give this one to everyone) and the **admin URL**. Options: `-Location westus3` if Postgres is restricted in the default region (`eastus2`), `-AllowedIp 203.0.113.7/32` to limit who can reach it (re-run without it to open the site up).
- **Before tearing down, open the admin page and Export CSV.** `down.ps1` deletes the database and the encryption key. Teardown is not reversible.
- Teardown is slow because Azure takes a long time to delete the Container Apps environment. Leave it running until it prints "Torn down". If your terminal closes midway, just run `down.ps1` again.
- It bills while it exists (Postgres and the app run continuously). `status.ps1` and `down.ps1` both confirm whether the resource group is gone.
- **Email.** By default the deployed app uses `mail_transport = "log"`: sign-in codes are written to the container log (Azure portal, the container app, Log stream) instead of being emailed. That is for demos only, since anyone who can read the logs can sign in as anyone. To send real email through Microsoft 365, set these before `up.ps1`: `$env:TF_VAR_mail_transport="graph"`, `$env:TF_VAR_mail_from`, `$env:TF_VAR_graph_tenant_id`, `$env:TF_VAR_graph_client_id`, `$env:TF_VAR_graph_client_secret` (what IT provides, see [docs/it-requirements.md](docs/it-requirements.md) need 12).
- **Close date.** Optional: `$env:TF_VAR_survey_closes_at="2027-01-15T23:59:00-05:00"`. After it, nobody can start, save, or submit, but respondents can still sign in to view and print.
- Demo script: open the respondent link, enter an email, get the code (Mailpit locally, the log stream in Azure), sign in, enter an org name and NPI (`1234567893` is a valid test NPI), fill in a few fields, Save and exit. Sign in again in a private window and see the answers, then Submit and see the read-only view. Then sign in at `/admin`: the response shows its owner email, start a second response with the same NPI from another address and see "Duplicate NPI", use "Change owner", and Export CSV.

Infrastructure is Terraform in [`infra/`](infra/). State is a local file (gitignored); keep it until you run `down.ps1`. The deployed hostname is the free `*.azurecontainerapps.io` one.

## What is in the repo

- `src/`: the Next.js app (respondent pages `/` and `/r`, admin `/admin`, API under `/api`)
- `infra/`: Terraform for Azure (Container Apps, private Postgres, registry, logs)
- `scripts/`: `up.ps1`, `down.ps1`, `status.ps1`, and the admin password hasher
- `docker-compose.yml`: local development only

## Docs

- [What we need from IT](docs/it-requirements.md): architecture, security controls, gaps, and likely IT questions
- [Plan](docs/plan.md)
- [ADR-0001: Hosting on Azure Container Apps](docs/adr/0001-hosting-azure-container-apps.md)
- [ADR-0002: Unique link as respondent credential](docs/adr/0002-token-link-credential.md) (superseded)
- [ADR-0003: Email one-time code sign-in](docs/adr/0003-email-code-sign-in.md) and its [spec](docs/specs/0003-email-code-sign-in.md)
