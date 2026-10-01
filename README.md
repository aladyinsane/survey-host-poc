# survey-host-poc

Proof of concept for hosting a containerized Next.js survey app (admin + respondent flow) with real security controls. Respondents use one generic link, get a unique link, and use it to save and resume their work.

> **Status:** working POC (respondent flow, admin, Azure deploy/teardown). The IT handoff doc and a hardening pass are still to come; see [docs/plan.md](docs/plan.md).

## Quick start

**Run locally (Docker)**

```bash
cp .env.example .env     # then fill in the secrets; the generator commands are in the file
node scripts/hash-admin-password.mjs   # prompts for an admin password, prints ADMIN_PASSWORD_HASH
docker compose up --build
```

Open http://localhost:3000 for respondents and http://localhost:3000/admin for the admin page (set `APP_PORT` in `.env` if 3000 is taken). Stop and wipe local data with `docker compose down -v`.

Checks (also run in CI): `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`.

**Deploy to Azure (public URL)**

One-time: install [Docker](https://www.docker.com/), [Terraform](https://developer.hashicorp.com/terraform/install) (1.9+), [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), and [Node](https://nodejs.org/). Then `az login`.

```powershell
./scripts/up.ps1        # asks for an admin password, then builds and deploys (about 10-15 min)
./scripts/status.ps1    # is it deployed? what is the URL? is it healthy?
./scripts/down.ps1      # destroys everything (asks you to type the resource group name)
```

- `up.ps1` prints the **respondent link** (give this one to everyone) and the **admin URL**. Options: `-Location westus3` if Postgres is restricted in the default region (`eastus2`), `-AllowedIp 203.0.113.7/32` to limit who can reach it, `-ResetAdminPassword`.
- **Before tearing down, open the admin page and Export CSV.** `down.ps1` deletes the database and the encryption key. Teardown is not reversible.
- It bills while it exists (Postgres and the app run continuously). `status.ps1` and `down.ps1` both confirm whether the resource group is gone.
- Demo script: open the respondent link, enter an org name, fill in a few fields, Save, close the tab, reopen the unique link (or use "Resume" on the home page), Submit. Then sign in at `/admin`, see the response, Export CSV, try "New link" on an in-progress response and show the old link stops working.

Infrastructure is Terraform in [`infra/`](infra/). State is a local file (gitignored); keep it until you run `down.ps1`.

## Docs

- [What we need from IT](docs/it-requirements.md): architecture, security controls, gaps, and likely IT questions
- [Plan](docs/plan.md)
- [ADR-0001: Hosting on Azure Container Apps](docs/adr/0001-hosting-azure-container-apps.md)
- [ADR-0002: Unique link as respondent credential](docs/adr/0002-token-link-credential.md)
