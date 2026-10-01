# Helpers for calling native commands (az, terraform, docker, node) from Windows PowerShell 5.1.
# 5.1 turns anything a native command writes to stderr into a terminating error when
# $ErrorActionPreference is Stop (terraform warnings, docker progress, az notices). These helpers
# switch to Continue around the call and decide success by exit code only.

# Run a command, stream its output, throw if the exit code is not 0.
function Invoke-Native {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $args[0] $args[1..($args.Length - 1)] 2>&1 | ForEach-Object { Write-Host "$_" }
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $($args -join ' ')" }
}

# Run a command and return its trimmed stdout. Returns $null if the exit code is not 0.
function Get-NativeOutput {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & $args[0] $args[1..($args.Length - 1)] 2>$null
  } finally {
    $ErrorActionPreference = $prev
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  return (($out | Out-String).Trim())
}
