param([string]$Root = (Get-Location).Path, [switch]$ReportOnly)
$ErrorActionPreference = "Stop"
$findings = @()
if (-not (Test-Path -LiteralPath $Root)) { $findings += [pscustomobject]@{ file=$Root; reason="root_not_found" } }
if ($findings.Count -eq 0) { [pscustomobject]@{ status="ok"; check="check-version-family"; root=$Root } | ConvertTo-Json } else { $findings | ConvertTo-Json -Depth 4 }
if ($findings.Count -gt 0 -and -not $ReportOnly) { exit 1 }
exit 0
