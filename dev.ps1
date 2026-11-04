param([ValidateSet('dev','build','test','preview')][string]$Task = 'dev')
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
  $runtimePath = Join-Path $PSScriptRoot '.tools\node_modules\node\bin\node.exe'
  if (-not (Test-Path -LiteralPath $runtimePath)) { $runtimePath = (Get-Command node -ErrorAction Stop).Source }
  if ($Task -eq 'build') {
    & $runtimePath 'node_modules/typescript/bin/tsc' -b
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $runtimePath 'node_modules/vite/bin/vite.js' build
  } elseif ($Task -eq 'test') {
    & $runtimePath 'node_modules/vitest/vitest.mjs' run
  } elseif ($Task -eq 'preview') {
    & $runtimePath 'node_modules/vite/bin/vite.js' preview --host 0.0.0.0
  } else {
    & $runtimePath 'node_modules/vite/bin/vite.js' --host 0.0.0.0
  }
  exit $LASTEXITCODE
} finally { Pop-Location }
