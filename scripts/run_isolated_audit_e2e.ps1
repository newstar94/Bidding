param(
    [ValidateSet("smoke", "ui-quality", "performance", "first-tab-performance", "auth-roles", "offline", "offline-soak", "websocket-missed-hint", "joint-venture", "low-price", "crud", "pairwise", "ui", "domain", "lifecycle", "bidder-goods", "all")]
    [string]$Suite = "all",
    [int]$Port = 8010
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
$baseUrl = "http://127.0.0.1:$Port"
$env:DATABASE_URL = $testUrl
$env:MIGRATOR_DATABASE_URL = $testUrl
$env:TEST_DATABASE_URL = $testUrl
$env:APP_ENV = "test"
$env:VNEPS_VIOLATION_FIXTURE_PATH = "tests/fixtures/vneps_contractor_violations.json"
$env:APP_DEBUG = "false"
$env:DATABASE_AUTO_MIGRATE = "false"
$env:APP_PUBLIC_URL = $baseUrl
$env:APP_SECURE_COOKIES = "false"
$env:CSRF_TRUSTED_ORIGINS = $baseUrl
$env:CORS_ORIGINS = $baseUrl
$env:ALLOWED_WS_ORIGINS = $baseUrl
$env:E2E_BASE_URL = $baseUrl
$env:TURNSTILE_ENABLED = "false"
$env:GOOGLE_AUTH_ENABLED = "false"

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
    -ArgumentList @("-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "$Port") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $serverStdout `
    -RedirectStandardError $serverStderr `
    -PassThru

try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing "$baseUrl/health/ready" -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {
            # Startup is bounded by the retry loop.
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        if (Test-Path -LiteralPath $serverStderr) {
            Get-Content -LiteralPath $serverStderr -Tail 80
        }
        if (Test-Path -LiteralPath $serverStdout) {
            Get-Content -LiteralPath $serverStdout -Tail 80
        }
        throw "Isolated test server did not become ready."
    }
    foreach ($command in $commands) {
        & npm run $command
        if ($LASTEXITCODE -ne 0) {
            throw "$command failed with exit code $LASTEXITCODE."
        }
    }
} finally {
    if ($server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id -Force
    }
    Remove-Item -LiteralPath $serverStdout, $serverStderr -Force -ErrorAction SilentlyContinue
}
