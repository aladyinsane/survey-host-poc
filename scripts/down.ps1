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
. (Join-Path $PSScriptRoot "_native.ps1")

foreach ($c in "az", "terraform") {
  if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "$c is not installed or not on PATH." }
}
$sub = Get-NativeOutput az account show --query id -o tsv
if (-not $sub) { throw "Not logged in. Run: az login" }
$env:ARM_SUBSCRIPTION_ID = $sub

if (-not $Force) {
  Write-Host "This permanently deletes the database, all responses, and the encryption key in $rg."
  Write-Host "Export the CSV from the admin page first if you need the data."
  $answer = Read-Host "Type the resource group name ($rg) to confirm"
  if ($answer -ne $rg) { Write-Host "Cancelled."; exit 1 }
}

# Step 1: Terraform destroy. If it fails, keep going: step 2 removes the resource group anyway.
Push-Location $infra
try {
  # Variables are required by the config but irrelevant when destroying.
  $env:TF_VAR_admin_password_hash = "destroy"
  Invoke-Native terraform destroy -input=false -auto-approve
} catch {
  Write-Warning "terraform destroy failed ($($_.Exception.Message)). Falling back to deleting the resource group."
} finally {
  Pop-Location
}

# Step 2: whatever is left in the resource group goes with it.
if ((Get-NativeOutput az group exists --name $rg) -ne "false") {
  Write-Warning "$rg still exists. Deleting it directly (this can take several minutes)..."
  try { Invoke-Native az group delete --name $rg --yes } catch { Write-Warning $_.Exception.Message }
}

# Step 3: verify. Do not claim success unless Azure says the group is gone.
if ((Get-NativeOutput az group exists --name $rg) -eq "false") {
  Write-Host "Torn down. $rg no longer exists, so nothing from this POC is billing."
} else {
  throw "$rg still exists or its status could not be checked. Delete it in the Azure portal."
}
