param([string]$Checkpoint = "")
$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
try {
  $service = Invoke-RestMethod "http://127.0.0.1:8766/health" -TimeoutSec 2
  if ($service.service -eq "caravaiggio-sam3") { Write-Host "SAM 3 service is already running."; exit 0 }
  throw "Port 8766 is occupied by another service."
} catch { if ($_.Exception.Message -eq "Port 8766 is occupied by another service.") { throw } }
$venvPython = Join-Path $repoPath "artifacts/sam3/.venv/Scripts/python.exe"
if (!(Test-Path -LiteralPath $venvPython)) { throw "Run tools/sam3/setup.ps1 first." }
$serverPath = Join-Path $PSScriptRoot "server.py"
$arguments = @('-u', ('"' + $serverPath + '"'))
if ($Checkpoint) {
  $resolvedCheckpoint = (Resolve-Path -LiteralPath $Checkpoint).Path
  $arguments += @('--checkpoint', ('"' + $resolvedCheckpoint + '"'))
}
$logPath = Join-Path $repoPath "artifacts/sam3"
Start-Process -FilePath $venvPython -ArgumentList $arguments -WorkingDirectory $repoPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath "server.out.log") -RedirectStandardError (Join-Path $logPath "server.err.log") | Out-Null
Write-Host "SAM 3 service started. Choose AI assisted in Posterization; first analysis loads the model."
