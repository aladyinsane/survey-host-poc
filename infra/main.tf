terraform {
  required_version = ">= 1.9"

  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
    time    = { source = "hashicorp/time", version = "~> 0.12" }
  }
}

# Subscription comes from ARM_SUBSCRIPTION_ID (scripts/up.ps1 sets it from `az account show`).
provider "azurerm" {
  features {}
}

locals {
  tags = { project = var.name, purpose = "poc", managed_by = "terraform" }
  # sslmode=require + uselibpqcompat: encrypted, certificate not verified. Traffic never leaves the
  # private VNet. Hardening item: ship the Azure CA bundle and verify the server certificate.
  database_url = "postgres://surveyadmin:${random_password.db.result}@${azurerm_postgresql_flexible_server.pg.fqdn}:5432/survey?sslmode=require&uselibpqcompat=true"
}

resource "random_string" "suffix" {
  length  = 6
  upper   = false
  special = false
}

# Generated per environment and kept only in Terraform state. Destroying the environment destroys
# the data and the key together.
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "random_id" "data_key" {
  byte_length = 32
}

resource "random_id" "session_secret" {
  byte_length = 32
}

resource "azurerm_resource_group" "rg" {
  name     = "rg-${var.name}"
  location = var.location
  tags     = local.tags
}

resource "azurerm_log_analytics_workspace" "logs" {
  name                = "log-${var.name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

resource "azurerm_container_registry" "acr" {
  name                = "acr${replace(var.name, "-", "")}${random_string.suffix.result}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "Basic"
  admin_enabled       = false # the app pulls with a managed identity, not shared credentials
  tags                = local.tags
}

resource "azurerm_user_assigned_identity" "app" {
  name                = "id-${var.name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags
}

resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.app.principal_id

  skip_service_principal_aad_check = true # the principal was just created; avoids a replication race
}

# Role assignments take a moment to propagate; creating the app too early fails the image pull.
resource "time_sleep" "role_propagation" {
  depends_on      = [azurerm_role_assignment.acr_pull]
  create_duration = "60s"
}

resource "azurerm_virtual_network" "vnet" {
  name                = "vnet-${var.name}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  address_space       = ["10.20.0.0/16"]
  tags                = local.tags
}

resource "azurerm_subnet" "apps" {
  name                 = "snet-apps"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.20.0.0/27"]

  delegation {
    name = "container-apps"
    service_delegation {
      name    = "Microsoft.App/environments"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_subnet" "db" {
  name                 = "snet-db"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["10.20.1.0/28"]

  delegation {
    name = "postgres"
    service_delegation {
      name    = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = ["Microsoft.Network/virtualNetworks/subnets/join/action"]
    }
  }
}

resource "azurerm_private_dns_zone" "pg" {
  name                = "${var.name}.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.rg.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "pg" {
  name                  = "pg-vnet-link"
  resource_group_name   = azurerm_resource_group.rg.name
  private_dns_zone_name = azurerm_private_dns_zone.pg.name
  virtual_network_id    = azurerm_virtual_network.vnet.id
  tags                  = local.tags
}

# Private access only: no public endpoint exists. TLS is required by default.
resource "azurerm_postgresql_flexible_server" "pg" {
  name                          = "psql-${var.name}-${random_string.suffix.result}"
  location                      = azurerm_resource_group.rg.location
  resource_group_name           = azurerm_resource_group.rg.name
  version                       = "16"
  delegated_subnet_id           = azurerm_subnet.db.id
  private_dns_zone_id           = azurerm_private_dns_zone.pg.id
  public_network_access_enabled = false
  administrator_login           = "surveyadmin"
  administrator_password        = random_password.db.result
  sku_name                      = var.db_sku
  storage_mb                    = 32768
  backup_retention_days         = 7
  tags                          = local.tags

  depends_on = [azurerm_private_dns_zone_virtual_network_link.pg]

  lifecycle {
    ignore_changes = [zone] # Azure picks the zone
  }
}

resource "azurerm_postgresql_flexible_server_database" "survey" {
  name      = "survey"
  server_id = azurerm_postgresql_flexible_server.pg.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_container_app_environment" "env" {
  name                       = "cae-${var.name}"
  location                   = azurerm_resource_group.rg.location
  resource_group_name        = azurerm_resource_group.rg.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
  infrastructure_subnet_id   = azurerm_subnet.apps.id
  tags                       = local.tags

  workload_profile {
    name                  = "Consumption"
    workload_profile_type = "Consumption"
  }
}

resource "azurerm_container_app" "app" {
  name                         = "ca-${var.name}"
  resource_group_name          = azurerm_resource_group.rg.name
  container_app_environment_id = azurerm_container_app_environment.env.id
  revision_mode                = "Single"
  workload_profile_name        = "Consumption"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.app.id
  }

  secret {
    name  = "database-url"
    value = local.database_url
  }
  secret {
    name  = "data-encryption-key"
    value = random_id.data_key.b64_std
  }
  secret {
    name  = "admin-password-hash"
    value = var.admin_password_hash
  }
  secret {
    name  = "admin-session-secret"
    value = random_id.session_secret.b64_std
  }

  ingress {
    external_enabled           = true
    target_port                = 3000
    transport                  = "http"
    allow_insecure_connections = false # plain HTTP is redirected to HTTPS

    traffic_weight {
      latest_revision = true
      percentage      = 100
    }

    dynamic "ip_security_restriction" {
      for_each = var.allowed_ip_ranges
      content {
        name             = "allow-${ip_security_restriction.key}"
        action           = "Allow"
        ip_address_range = ip_security_restriction.value
      }
    }
  }

  template {
    # Exactly one replica: the app's rate limiter is in memory and per process.
    min_replicas = 1
    max_replicas = 1

    container {
      name   = "app"
      image  = "${azurerm_container_registry.acr.login_server}/survey-host-poc:${var.image_tag}"
      cpu    = 0.5
      memory = "1Gi"

      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "DATA_ENCRYPTION_KEY"
        secret_name = "data-encryption-key"
      }
      env {
        name        = "ADMIN_PASSWORD_HASH"
        secret_name = "admin-password-hash"
      }
      env {
        name        = "ADMIN_SESSION_SECRET"
        secret_name = "admin-session-secret"
      }

      liveness_probe {
        transport = "HTTP"
        path      = "/healthz"
        port      = 3000
      }
      readiness_probe {
        transport = "HTTP"
        path      = "/healthz"
        port      = 3000
      }
    }
  }

  depends_on = [time_sleep.role_propagation, azurerm_postgresql_flexible_server_database.survey]
}
