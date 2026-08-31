[CmdletBinding()]
param(
    [switch]$HealthCheckOnly,
    [switch]$Once,
    [ValidateRange(1, 300)]
    [int]$RestartDelaySeconds = 5
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$pythonExe = 'C:\Users\newst\AppData\Local\Programs\Python\Python314\python.exe'
$healthUri = 'http://127.0.0.1:8000/health/ready'
$logRoot = Join-Path $repo 'data\logs'

function Test-BiddingFlowReady {
    try {
        $response = Invoke-WebRequest -Uri $healthUri -UseBasicParsing -TimeoutSec 3
        if ([int]$response.StatusCode -ne 200) {
            return $false
        }
        $payload = $response.Content | ConvertFrom-Json
        return [string]$payload.status -eq 'ready'
    } catch {
        return $false
    }
}

if (Test-BiddingFlowReady) {
    Write-Output 'BiddingFlow is already ready on 127.0.0.1:8000.'
    exit 0
}
if ($HealthCheckOnly) {
    Write-Error 'BiddingFlow is not ready on 127.0.0.1:8000.'
    exit 1
}

if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    Write-Error "Python executable not found: $pythonExe"
    exit 2
}

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

while ($true) {
    if (Test-BiddingFlowReady) {
        Write-Output 'Another healthy BiddingFlow process took ownership of port 8000.'
        exit 0
    }
    $listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        Write-Error "Port 8000 is occupied by PID $($listeners[0].OwningProcess), but BiddingFlow readiness failed."
        exit 48
    }

    $markerPath = Join-Path $repo 'dist\secure-build.json'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        Write-Error "Secure frontend marker not found: $markerPath"
        exit 3
    }
    $releaseId = [string](Get-Content -Raw -Encoding UTF8 -LiteralPath $markerPath | ConvertFrom-Json).releaseId
    if ($releaseId -notmatch '^[0-9a-f]{40}$|^[0-9a-f]{64}$') {
        Write-Error 'Secure frontend marker has an invalid release ID.'
        exit 4
    }

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdoutPath = Join-Path $logRoot "demo-server-supervised-$stamp.out.log"
    $stderrPath = Join-Path $logRoot "demo-server-supervised-$stamp.err.log"

    # The public demo must never use Uvicorn's source reloader. Besides creating
    # a second Python process, the reloader intentionally restarts the server
    # whenever files change and looks like an application crash to remote clients.
    $env:APP_DEBUG = 'False'
    $env:FRONTEND_ASSET_MODE = 'source'
    $env:APP_RELEASE_ID = $releaseId

    $process = Start-Process `
        -FilePath $pythonExe `
        -ArgumentList 'backend/app.py' `
        -WorkingDirectory $repo `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -Wait `
        -PassThru

    if ($Once) {
        exit $process.ExitCode
    }
    Write-Warning "BiddingFlow PID $($process.Id) exited with code $($process.ExitCode); restarting in $RestartDelaySeconds second(s)."
    Start-Sleep -Seconds $RestartDelaySeconds
}
