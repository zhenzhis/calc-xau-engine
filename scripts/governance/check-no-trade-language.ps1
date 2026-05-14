param([string]$Root = (Get-Location).Path, [switch]$ReportOnly, [switch]$EnforceProductionPaths)
$ErrorActionPreference = "Stop"
$phrases = @("buy", "sell", "short", "long", "hedge now", "enter", "exit")
$excluded = "(^|/)(docs|tests|test|examples|fixtures|snapshots|historical)/"
$prodPath = "(^|/)(src/)?(discord|cards?|output|formatter|templates?)/"
$tracked = & git -C $Root ls-files 2>$null | Where-Object { $_ -match '\.(ts|tsx|js|jsx|py|md)$' -and $_ -notmatch $excluded }
$findings = @()
foreach ($rel in $tracked) {
  $file = Join-Path $Root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $file)) { continue }
  $lineNo = 0
  Get-Content -LiteralPath $file -ErrorAction SilentlyContinue | ForEach-Object {
    $lineNo++
    $line = $_
    foreach ($phrase in $phrases) {
      if ($line -match "(?i)\b$([regex]::Escape($phrase))\b") {
        $reason = if ($rel -match $prodPath) { "production_output_language_candidate" } else { "research_language_review" }
        $findings += [pscustomobject]@{ file=$rel; line=$lineNo; matched_phrase=$phrase; reason=$reason }
      }
    }
  }
}
$findings | ConvertTo-Json -Depth 4
$hard = $findings | Where-Object { $_.reason -eq "production_output_language_candidate" }
if ($EnforceProductionPaths -and -not $ReportOnly -and $hard.Count -gt 0) { exit 1 }
exit 0