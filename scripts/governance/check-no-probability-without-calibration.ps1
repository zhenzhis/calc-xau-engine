param([string]$Root = (Get-Location).Path, [switch]$ReportOnly, [switch]$EnforceProductionPaths)
$ErrorActionPreference = "Stop"
$phrases = @("probability", "probable", "odds", "chance", "likely", "guaranteed")
$excluded = "(^|/)(docs|tests|test|examples|fixtures|snapshots|historical)/"
$prodPath = "(^|/)(src/)?(discord|cards?|output|formatter|templates?)/"
$tracked = & git -C $Root ls-files 2>$null | Where-Object { $_ -match '\.(ts|tsx|js|jsx|py)$' -and $_ -notmatch $excluded }
$findings = @()
foreach ($rel in $tracked) {
  $file = Join-Path $Root ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $file)) { continue }
  $content = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
  $hasCalibration = $content -match "calibratedProbability\s*[:=]\s*true" -or $content -match "calibrated_probability\s*[:=]\s*true"
  $lineNo = 0
  $content -split "`r?`n" | ForEach-Object {
    $lineNo++
    foreach ($phrase in $phrases) {
      if ($_ -match "(?i)\b$([regex]::Escape($phrase))\b" -and -not $hasCalibration) {
        $reason = if ($rel -match $prodPath) { "uncalibrated_probability_language_in_production_output_candidate" } else { "uncalibrated_probability_language_review" }
        $findings += [pscustomobject]@{ file=$rel; line=$lineNo; matched_phrase=$phrase; reason=$reason }
      }
    }
  }
}
$findings | ConvertTo-Json -Depth 4
$hard = $findings | Where-Object { $_.reason -eq "uncalibrated_probability_language_in_production_output_candidate" }
if ($EnforceProductionPaths -and -not $ReportOnly -and $hard.Count -gt 0) { exit 1 }
exit 0