<#
.SYNOPSIS
  Show whether the POC exists in Azure and what is running.
#>
$ErrorActionPreference = "Stop"
$rg = "rg-survey-poc"

. (Join-Path $PSScriptRoot "_native.ps1")
$exists = Get-NativeOutput az group exists --name $rg
if ($exists -ne "true") {
  Write-Host "Not deployed ($rg does not exist). Nothing is billing."
  exit 0
}
Write-Host "Deployed: $rg exists, so it is billing."
az resource list --resource-group $rg --query "[].{type:type, name:name}" -o table
$fqdn = Get-NativeOutput az containerapp list --resource-group $rg --query "[0].properties.configuration.ingress.fqdn" -o tsv
if ($fqdn) {
  Write-Host "`nRespondent link: https://$fqdn"
  Write-Host "Admin:           https://$fqdn/admin"
  try {
    $r = Invoke-WebRequest -UseBasicParsing "https://$fqdn/healthz" -TimeoutSec 15
    Write-Host "Health check:    $($r.StatusCode)"
  } catch { Write-Host "Health check:    FAILED ($($_.Exception.Message))" }
}
