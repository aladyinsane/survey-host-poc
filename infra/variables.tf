variable "name" {
  description = "Base name for all resources. Lowercase letters, digits, hyphens."
  type        = string
  default     = "survey-poc"
}

variable "location" {
  description = "Azure region. If Postgres Flexible Server is restricted for your subscription in this region, try another."
  type        = string
  default     = "eastus2"
}

variable "image_tag" {
  description = "Tag of the survey-host-poc image already pushed to the registry."
  type        = string
  default     = "latest"
}

variable "admin_password_hash" {
  description = "Value for ADMIN_PASSWORD_HASH (see scripts/hash-admin-password.mjs)."
  type        = string
  sensitive   = true
}

variable "db_sku" {
  description = "Postgres Flexible Server SKU. Burstable B1ms is the cheapest."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "allowed_ip_ranges" {
  description = "CIDR ranges allowed to reach the app. Empty means open to the internet."
  type        = list(string)
  default     = []
}

variable "mail_transport" {
  description = "How sign-in codes are emailed: graph (Microsoft 365) or log (writes codes to the container log; demos only, never real respondents)."
  type        = string
  default     = "log"
  validation {
    condition     = contains(["graph", "log"], var.mail_transport)
    error_message = "mail_transport must be graph or log."
  }
}

variable "mail_from" {
  description = "No-reply address codes are sent from (required for graph)."
  type        = string
  default     = ""
}

variable "graph_tenant_id" {
  description = "Microsoft Entra tenant of the mail-sending app registration (graph only)."
  type        = string
  default     = ""
}

variable "graph_client_id" {
  description = "Client ID of the app registration allowed to send as mail_from (graph only)."
  type        = string
  default     = ""
}

variable "graph_client_secret" {
  description = "Client secret of that app registration (graph only)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "survey_closes_at" {
  description = "Optional ISO 8601 date-time after which nobody can start, save, or submit, e.g. 2027-01-15T23:59:00-05:00."
  type        = string
  default     = ""
}
