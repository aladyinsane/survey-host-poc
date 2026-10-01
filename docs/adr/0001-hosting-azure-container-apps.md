# ADR-0001: Host on Azure Container Apps with Postgres Flexible Server, defined in Terraform

Status: Accepted (2026-09-30)

## Context
We need a publicly reachable, containerized survey app that handles sensitive financial responses. It must be quick to build and tear down for demos, cheap while idle, and look like something a corporate IT team can review and adopt. The author's employer uses Azure and Terraform, so staying close to both lowers the cost of handing this over.

## Decision
- Run the app on Azure Container Apps (managed HTTPS on an `azurecontainerapps.io` hostname, scale to zero).
- Store data in Azure Database for PostgreSQL Flexible Server (Burstable), reachable only from the app.
- Define everything in Terraform (azurerm) in one resource group. `up` is `terraform apply`, `down` is `terraform destroy`.
- Docker Compose is for local development only.

## Alternatives considered
- **VM + Docker Compose + Caddy:** cheap and simple, but we would own OS patching, SSH exposure, and certificate handling. More for IT to object to.
- **Postgres in a container with a mounted volume:** cheaper, but weaker backup, patching, and encryption story, and awkward on Container Apps.
- **Bicep:** more Azure-native, but IT uses Terraform.

## Consequences
- Managed TLS, patching, and encryption at rest come from the platform, not from us.
- Flexible Server bills hourly while it exists, roughly $13/month if left running. Teardown must destroy it. Stopping it is not enough, Azure restarts stopped servers after 7 days.
- Destroying the environment wipes data by default. Fine for a POC, not for a live survey, which needs a persistent environment plus backups.
- Terraform state is a local file for the POC. It must not be committed (it can contain secrets), and losing it orphans resources until deleted from the portal.
- Tied to Azure. Terraform modules would need rewriting for another cloud.
