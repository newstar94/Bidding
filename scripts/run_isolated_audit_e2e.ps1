param(
    [ValidateSet("smoke", "ui-quality", "performance", "first-tab-performance", "auth-shell", "auth-roles", "offline", "offline-soak", "websocket-missed-hint", "joint-venture", "low-price", "crud", "pairwise", "multi-assignee", "ui", "domain", "lifecycle", "bidder-goods", "all")]
    [string]$Suite = "all",
    [ValidateSet("all", "chromium", "firefox", "webkit")]
    [string]$Project = "all",
    [ValidateSet("127.0.0.1", "127.0.0.2")]
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8010,
    [string]$Grep = "",
    [ValidateSet("backend.app:app", "scripts.diagnostics.font_preload_app:app")]
    [string]$ServerApp = "backend.app:app"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$testUrl = [string]$env:TEST_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($testUrl)) {
    $testLine = Get-Content (Join-Path $root ".env") |
        Where-Object { $_ -match '^TEST_DATABASE_URL=' } |
        Select-Object -First 1
    if (-not $testLine) {
        throw "TEST_DATABASE_URL is required."
    }
    $testUrl = ($testLine -replace '^TEST_DATABASE_URL=', '').Trim().Trim('"').Trim("'")
}
$testUrl = $testUrl.Trim()
$baseUrl = "http://${HostAddress}:$Port"
$env:DATABASE_URL = $testUrl
$env:MIGRATOR_DATABASE_URL = $testUrl
$env:TEST_DATABASE_URL = $testUrl
$env:APP_ENV = "test"
$env:VNEPS_VIOLATION_FIXTURE_PATH = "tests/fixtures/vneps_contractor_violations.json"
$env:APP_DEBUG = "false"
$env:DATABASE_AUTO_MIGRATE = "false"
$env:APP_PUBLIC_URL = $baseUrl
$env:ALLOWED_HOSTS = $HostAddress
$env:APP_SECURE_COOKIES = "false"
$env:CSRF_TRUSTED_ORIGINS = $baseUrl
$env:CORS_ORIGINS = $baseUrl
$env:ALLOWED_WS_ORIGINS = $baseUrl
$env:E2E_BASE_URL = $baseUrl
$env:TURNSTILE_ENABLED = "false"
$env:GOOGLE_AUTH_ENABLED = "false"
$env:ENABLE_IMAGE_CACHE_PREWARM = "false"
$env:ENABLE_PARTNER_LOOKUP_WORKER = "false"
# Windows PowerShell 5 removes an empty environment variable. A whitespace
# value survives process creation and resolve_runtime_path strips it to the
# intended explicit-empty test setting, rather than using developer checkpoints.
# Database audit-chain verification remains enabled.
$env:AUDIT_CHECKPOINT_DIR = " "

$uiCommands = @(
    "test:e2e:smoke",
    "test:auth-shell",
    "test:ui-quality-e2e",
    "test:authenticated-ui-matrix"
)
$domainCommands = @(
    "test:auth-roles-e2e",
    "test:offline-sync-e2e",
    "test:multi-assignee-e2e",
    "test:joint-venture-e2e",
    "test:low-price-conflict-e2e",
    "test:crud-modules-e2e",
    "test:package-pairwise-e2e",
    "test:lifecycle"
)
$commands = if ($Suite -eq "smoke") {
    @("test:e2e:smoke")
} elseif ($Suite -eq "ui-quality") {
    @("test:ui-quality-e2e")
} elseif ($Suite -eq "performance") {
    @("test:performance")
} elseif ($Suite -eq "first-tab-performance") {
    @("test:first-tab-performance")
} elseif ($Suite -eq "auth-roles") {
    @("test:auth-roles-e2e")
} elseif ($Suite -eq "auth-shell") {
    @("test:auth-shell")
} elseif ($Suite -eq "offline") {
    @("test:offline-sync-e2e")
} elseif ($Suite -eq "offline-soak") {
    @("test:offline-sync-e2e:soak")
} elseif ($Suite -eq "websocket-missed-hint") {
    @("test:websocket-missed-hint-e2e")
} elseif ($Suite -eq "joint-venture") {
    @("test:joint-venture-e2e")
} elseif ($Suite -eq "low-price") {
    @("test:low-price-conflict-e2e")
} elseif ($Suite -eq "crud") {
    @("test:crud-modules-e2e")
} elseif ($Suite -eq "pairwise") {
    @("test:package-pairwise-e2e")
} elseif ($Suite -eq "multi-assignee") {
    @("test:multi-assignee-e2e")
} elseif ($Suite -eq "ui") {
    $uiCommands
} elseif ($Suite -eq "domain") {
    $domainCommands
} elseif ($Suite -eq "lifecycle") {
    @("test:lifecycle")
} elseif ($Suite -eq "bidder-goods") {
    @("test:bidder-goods-e2e")
} else {
    $uiCommands + $domainCommands
}

$serverStdout = Join-Path ([System.IO.Path]::GetTempPath()) "biddingflow-e2e-server-$Port.stdout.log"
$serverStderr = Join-Path ([System.IO.Path]::GetTempPath()) "biddingflow-e2e-server-$Port.stderr.log"
$server = Start-Process -FilePath "python" `
    -ArgumentList @("-m", "uvicorn", $ServerApp, "--host", $HostAddress, "--port", "$Port", "--no-proxy-headers") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serverStdout `
    -RedirectStandardError $serverStderr `
    -PassThru

$suiteSucceeded = $false
try {
    $ready = $false
    $readinessFailure = ""
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing "$baseUrl/health/ready" -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            $readinessFailure = $_.ErrorDetails.Message
            # Startup is bounded by the retry loop.
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        if ($readinessFailure) { Write-Output "Readiness response: $readinessFailure" }
        if (Test-Path -LiteralPath $serverStderr) {
            Get-Content -LiteralPath $serverStderr -Tail 80
        }
        if (Test-Path -LiteralPath $serverStdout) {
            Get-Content -LiteralPath $serverStdout -Tail 80
        }
        throw "Isolated test server did not become ready."
    }
    foreach ($command in $commands) {
        if ($command -eq "test:e2e:smoke") {
            $playwrightArgs = @()
            if ($Project -ne "all") {
                $playwrightArgs += "--project=$Project"
            }
            if (-not [string]::IsNullOrWhiteSpace($Grep)) {
                $playwrightArgs += "--grep=$Grep"
            }
            if ($playwrightArgs.Count -gt 0) {
                & npm run $command -- @playwrightArgs
            } else {
                & npm run $command
            }
        } else {
            & npm run $command
        }
        if ($LASTEXITCODE -ne 0) {
            throw "$command failed with exit code $LASTEXITCODE."
        }
    }
    $suiteSucceeded = $true
} catch {
    Write-Output "--- Isolated E2E server stderr ($serverStderr) ---"
    if (Test-Path -LiteralPath $serverStderr) {
        Get-Content -LiteralPath $serverStderr -Tail 160
    }
    Write-Output "--- Isolated E2E server stdout ($serverStdout) ---"
    if (Test-Path -LiteralPath $serverStdout) {
        Get-Content -LiteralPath $serverStdout -Tail 160
    }
    throw
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
    if ($suiteSucceeded) {
        Remove-Item -LiteralPath $serverStdout, $serverStderr -Force -ErrorAction SilentlyContinue
    } else {
        Write-Warning "Isolated E2E diagnostics retained at $serverStdout and $serverStderr"
    }
}
