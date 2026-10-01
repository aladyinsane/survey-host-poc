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
