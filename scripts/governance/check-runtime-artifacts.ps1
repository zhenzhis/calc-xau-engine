param([string]$Root = (Get-Location).Path, [switch]$ReportOnly)
$ErrorActionPreference = "Stop"
$patterns = @("(^|/)\.env($|\.(local|production|development|staging|sidecar|secret|private)$)", "(^|/)env-backups/", "\.sqlite3?$", "\.db$", "\.log$", "(^|/)\.runtime/", "(^|/)dist/", "(^|/)build/", "(^|/)coverage/", "(^|/)node_modules/", "(^|/)data/(raw|artifacts|cache|runtime|logs|dumps)/")
$tracked = & git -C $Root ls-files 2>$null
$findings = @()
foreach ($file in $tracked) {
  foreach ($pattern in $patterns) {
    if ($file -match $pattern) { $findings += [pscustomobject]@{ file=$file; reason="tracked_runtime_or_secret_artifact" }; break }
  }
}
$findings | ConvertTo-Json -Depth 4
if ($findings.Count -gt 0 -and -not $ReportOnly) { exit 1 }
exit 0