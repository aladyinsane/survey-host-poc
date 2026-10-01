# survey-host-poc

Proof of concept for hosting a containerized Next.js survey app (admin + respondent flow) with real security controls. Respondents use one generic link, get a unique link, and use it to save and resume their work.

> **Status:** planning. The app, scripts, and infrastructure land in later PRs (see [docs/plan.md](docs/plan.md)). The Quick start below is filled in as each piece ships.

## Quick start

Available now: run the skeleton locally (below). The rest lands in later PRs.

**Run locally (Docker)**

```bash
cp .env.example .env     # then set DATA_ENCRYPTION_KEY (generator command is in the file)
docker compose up --build
```

Open http://localhost:3000 (set `APP_PORT` in `.env` if 3000 is taken). Stop and wipe local data with `docker compose down -v`.

Checks (also run in CI): `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`.

Planned steps:

1. **One-time setup:** install Docker, Terraform, Azure CLI; `az login`; copy `.env.example` to `.env`.
2. **Run locally:** see above
3. **Build and deploy to Azure:** `./scripts/up.ps1`
4. **Demo:** the generic link, the admin URL, and a short demo script.
5. **Tear down:** `./scripts/down.ps1`, then confirm nothing is still billing.

## Docs

- [Plan](docs/plan.md)
- [ADR-0001: Hosting on Azure Container Apps](docs/adr/0001-hosting-azure-container-apps.md)
- [ADR-0002: Unique link as respondent credential](docs/adr/0002-token-link-credential.md)
