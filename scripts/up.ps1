<#
.SYNOPSIS
  Build and deploy the whole POC to Azure (about 15-20 minutes). Prints the survey and admin URLs.
.PARAMETER Location
  Azure region. Default eastus2. Try another if Postgres Flexible Server is restricted there.
.PARAMETER AllowedIp
  Optional CIDR ranges allowed to reach the app (for example your own IP while testing).
  Default is open to the internet.
.PARAMETER ResetAdminPassword
  Prompt for a new admin password even if one was saved from a previous run.
#>
param(
  [string]$Location = "eastus2",
  [string[]]$AllowedIp = @(),
  [switch]$ResetAdminPassword
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$infra = Join-Path $root "infra"
$rg = "rg-survey-poc"

function Need($cmd) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is not installed or not on PATH." }
}
Need az; Need terraform; Need docker; Need node
& cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Docker is installed but not running. Start Docker Desktop and retry." }

. (Join-Path $PSScriptRoot "_native.ps1")

$sub = Get-NativeOutput az account show --query id -o tsv
if (-not $sub) { throw "Not logged in. Run: az login" }
$env:ARM_SUBSCRIPTION_ID = $sub
Write-Host "Subscription: $(Get-NativeOutput az account show --query name -o tsv)"

# Admin password: prompt once, keep only the hash (gitignored) so redeploys do not re-prompt.
$hashFile = Join-Path $infra ".admin-hash"
if ($ResetAdminPassword -or -not (Test-Path $hashFile)) {
  $secure = Read-Host "Choose an admin password (min 12 characters)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  $ErrorActionPreference = "Continue"
  $hash = $plain | node (Join-Path $PSScriptRoot "hash-admin-password.mjs") 2>$null
  $ErrorActionPreference = "Stop"
  if ($LASTEXITCODE -ne 0 -or -not $hash) { throw "Password too short or hashing failed." }
  Set-Content -Path $hashFile -Value $hash.Trim() -NoNewline
}
$env:TF_VAR_admin_password_hash = (Get-Content $hashFile -Raw).Trim()
$env:TF_VAR_location = $Location
if ($AllowedIp.Count -gt 0) { $env:TF_VAR_allowed_ip_ranges = (ConvertTo-Json -Compress -InputObject @($AllowedIp)) }

Write-Host "Registering Azure resource providers (one-time, can take a minute)..."
foreach ($p in "Microsoft.App", "Microsoft.ContainerRegistry", "Microsoft.DBforPostgreSQL", "Microsoft.OperationalInsights", "Microsoft.ManagedIdentity", "Microsoft.Network") {
  Invoke-Native az provider register --namespace $p --wait
}

Push-Location $infra
try {
  Invoke-Native terraform init -input=false

  # Step 1: resource group and registry only, so there is somewhere to push the image.
  Write-Host "`n[1/3] Creating registry..."
  # Quote -target values: 5.1 splits an unquoted -name=a.b token at the dot.
  Invoke-Native terraform apply "-input=false" "-auto-approve" "-target=azurerm_resource_group.rg" "-target=azurerm_container_registry.acr"

  $acr = Get-NativeOutput az acr list --resource-group $rg --query "[0].name" -o tsv
  if (-not $acr) { throw "Registry not found in $rg" }

  Write-Host "`n[2/3] Building and pushing the image..."
  $tag = Get-Date -Format "yyyyMMddHHmmss"
  $image = "$acr.azurecr.io/survey-host-poc:$tag"
  Invoke-Native az acr login --name $acr
  Invoke-Native docker build -t $image $root
  Invoke-Native docker push $image

  # Step 3: everything else (Postgres and the Container Apps environment take the longest).
  Write-Host "`n[3/3] Creating database and app (about 10-15 minutes)..."
  $env:TF_VAR_image_tag = $tag
  try {
    Invoke-Native terraform apply -input=false -auto-approve
  } catch {
    Write-Warning "Deploy failed after some resources were created. Fix the error and re-run ./scripts/up.ps1 (safe to repeat),"
    Write-Warning "or run ./scripts/down.ps1 to remove everything. If Postgres is not available in $Location, retry with -Location <other region>"
    Write-Warning "after running down.ps1 (changing region on an existing deployment replaces it)."
    throw
  }

  $url = (Get-NativeOutput terraform output -raw survey_url)
  $admin = (Get-NativeOutput terraform output -raw admin_url)
} finally {
  Pop-Location
}

Write-Host "`nDone."
Write-Host "  Respondent link (generic): $url"
Write-Host "  Admin:                     $admin"
Write-Host "`nIt bills hourly while it exists (a few cents per hour, estimated). Tear down with: ./scripts/down.ps1"
