output "resource_group" {
  value = azurerm_resource_group.rg.name
}

output "registry_name" {
  value = azurerm_container_registry.acr.name
}

output "registry_login_server" {
  value = azurerm_container_registry.acr.login_server
}

output "survey_url" {
  description = "The generic link to give respondents."
  value       = "https://${azurerm_container_app.app.ingress[0].fqdn}"
}

output "admin_url" {
  value = "https://${azurerm_container_app.app.ingress[0].fqdn}/admin"
}
