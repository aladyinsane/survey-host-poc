<#
.SYNOPSIS
  Destroy everything in Azure so nothing keeps billing. This deletes all survey data and the
  encryption key. Export the CSV from /admin first if you need the responses.
.PARAMETER Force
  Skip the confirmation prompt.
#>
param([switch]$Force)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$infra = Join-Path $root "infra"
$rg = "rg-survey-poc"

foreach ($c in "az", "terraform") {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "$c is not installed or not on PATH." }
}
$sub = az account show --query id -o tsv
if ($LASTEXITCODE -ne 0 -or -not $sub) { throw "Not logged in. Run: az login" }
$env:ARM_SUBSCRIPTION_ID = $sub

if (-not $Force) {
  Write-Host "This permanently deletes the database, all responses, and the encryption key in $rg."
  Write-Host "Export the CSV from the admin page first if you need the data."
  $answer = Read-Host "Type the resource group name ($rg) to confirm"
  if ($answer -ne $rg) { Write-Host "Cancelled."; exit 1 }
}

Push-Location $infra
try {
  # Variables are required by the config but irrelevant when destroying.
  $env:TF_VAR_admin_password_hash = "destroy"
  terraform destroy -input=false -auto-approve
  if ($LASTEXITCODE -ne 0) { throw "terraform destroy failed. Re-run, or delete $rg in the Azure portal." }
} finally {
  Pop-Location
}

# Belt and braces: confirm the resource group is really gone.
$exists = az group exists --name $rg
if ($exists -eq "true") {
  Write-Warning "$rg still exists. Deleting it directly..."
  az group delete --name $rg --yes
  if ((az group exists --name $rg) -eq "true") { throw "$rg still exists. Delete it in the Azure portal." }
}
Write-Host "Torn down. Nothing from this POC should be billing now."
