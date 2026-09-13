[CmdletBinding()]
param([int]$DatabasePort = 55448, [int]$HttpsPort = 7443)

$ErrorActionPreference = 'Stop'
$biddingRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$chuanHoaRoot = 'D:\Chuẩn Hóa'
$mappedRoot = 'T:\'
$mappingCreated = $false
$postgresStarted = $false
$apiProcess = $null
$temporary = Join-Path $biddingRoot '.tmp\chuan-hoa-https-contract'
$postgresBin = 'T:\.tools\postgresql\pgsql\bin'
$dataDirectory = Join-Path $temporary 'postgres-data'
$postgresLog = Join-Path $temporary 'postgres.log'
$databaseName = 'chuanhoa_https_contract'
$certificate = Join-Path $temporary 'localhost.pem'
$certificateKey = Join-Path $temporary 'localhost.key'
$apiLog = Join-Path $temporary 'api.log'
$secret = 'local-contract-secret-32-characters-minimum'

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$Label) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

try {
    if (Test-Path -LiteralPath $mappedRoot) { throw 'Drive T: is already in use; choose an unused temporary mapping before running this verifier.' }
    & subst.exe 'T:' $chuanHoaRoot
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create ASCII-path mapping for Chuẩn Hóa.' }
    $mappingCreated = $true
    New-Item -ItemType Directory -Path $temporary -Force | Out-Null
    $initdb = Join-Path $postgresBin 'initdb.exe'
    $pgCtl = Join-Path $postgresBin 'pg_ctl.exe'
$createdb = Join-Path $postgresBin 'createdb.exe'
$dropdb = Join-Path $postgresBin 'dropdb.exe'
    $psql = Join-Path $postgresBin 'psql.exe'
    foreach ($port in @($DatabasePort, $HttpsPort)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use." }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION'))) {
        Invoke-Checked $initdb @('-D', $dataDirectory, '-A', 'trust', '-U', 'postgres', '--encoding=UTF8', '--no-locale') 'initialize isolated PostgreSQL'
    }
    Invoke-Checked $pgCtl @('-D', $dataDirectory, '-l', $postgresLog, '-o', "-p $DatabasePort -h 127.0.0.1", '-w', 'start') 'start isolated PostgreSQL'
    $postgresStarted = $true
    & $dropdb '--if-exists' '-h' '127.0.0.1' '-p' "$DatabasePort" '-U' 'postgres' $databaseName | Out-Null
    Invoke-Checked $createdb @('-h', '127.0.0.1', '-p', "$DatabasePort", '-U', 'postgres', $databaseName) 'create isolated database'
    Invoke-Checked $psql @('-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', "$DatabasePort", '-U', 'postgres', '-d', $databaseName, '-f', (Join-Path $mappedRoot 'database\migrations\V001__identity_trial_commercial_foundation.sql')) 'apply V001'
    Invoke-Checked $psql @('-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', "$DatabasePort", '-U', 'postgres', '-d', $databaseName, '-f', (Join-Path $mappedRoot 'database\migrations\V002__admin_integration_commands.sql')) 'apply V002'
    $seed = "INSERT INTO users (id, normalized_email, display_name, status, created_at_utc, updated_at_utc) VALUES ('11111111-1111-1111-1111-111111111111','https-contract@example.invalid','HTTPS Contract','ACTIVE',now(),now()); INSERT INTO products (id, code, display_name, status, created_at_utc) VALUES ('22222222-2222-2222-2222-222222222222','HTTPS-CONTRACT','HTTPS Contract','ACTIVE',now());"
    Invoke-Checked $psql @('-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', "$DatabasePort", '-U', 'postgres', '-d', $databaseName, '-c', $seed) 'seed isolated database'
    Invoke-Checked 'dotnet' @('dev-certs', 'https', '--export-path', $certificate, '--format', 'Pem', '--no-password') 'export local HTTPS certificate'

    $saved = @{}
    foreach ($name in @('ASPNETCORE_URLS','ASPNETCORE_ENVIRONMENT','ASPNETCORE_Kestrel__Certificates__Default__Path','ASPNETCORE_Kestrel__Certificates__Default__KeyPath','ConnectionStrings__ChuanHoa','ChuanHoa__AdminIntegration__Enabled','ChuanHoa__AdminIntegration__ClientId','ChuanHoa__AdminIntegration__SharedSecret')) { $saved[$name] = [Environment]::GetEnvironmentVariable($name); }
    $env:ASPNETCORE_URLS = "https://localhost:$HttpsPort"
    $env:ASPNETCORE_ENVIRONMENT = 'Production'
    $env:ASPNETCORE_Kestrel__Certificates__Default__Path = $certificate
    $env:ASPNETCORE_Kestrel__Certificates__Default__KeyPath = $certificateKey
    $env:ConnectionStrings__ChuanHoa = "Host=127.0.0.1;Port=$DatabasePort;Database=$databaseName;Username=postgres;Pooling=false"
    $env:ChuanHoa__AdminIntegration__Enabled = 'true'
    $env:ChuanHoa__AdminIntegration__ClientId = 'bidding-admin'
    $env:ChuanHoa__AdminIntegration__SharedSecret = $secret
    $apiProcess = Start-Process -FilePath 'dotnet' -ArgumentList @((Join-Path $mappedRoot 'src\ChuanHoa.Api\bin\Debug\net10.0\ChuanHoa.Api.dll')) -WorkingDirectory $mappedRoot -WindowStyle Hidden -RedirectStandardOutput $apiLog -RedirectStandardError (Join-Path $temporary 'api-error.log') -PassThru
    foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]); }
    $ready = $false
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if ($apiProcess.HasExited) { throw "Chuẩn Hóa API exited early. See $apiLog." }
        try { $response = Invoke-WebRequest -Uri "https://localhost:$HttpsPort/health" -UseBasicParsing -SkipCertificateCheck -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready = $true; break } } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $ready) { throw 'Chuẩn Hóa HTTPS API did not become ready.' }
    $env:CHUAN_HOA_ADMIN_BASE_URL = "https://localhost:$HttpsPort"
    $env:CHUAN_HOA_ADMIN_CLIENT_ID = 'bidding-admin'
    $env:CHUAN_HOA_ADMIN_SHARED_SECRET = $secret
    $env:CHUAN_HOA_ADMIN_CA_BUNDLE = $certificate
    & python (Join-Path $biddingRoot 'scripts\verify_chuan_hoa_https_contract.py')
    if ($LASTEXITCODE -ne 0) { throw "Bidding HTTPS contract client failed with exit code $LASTEXITCODE." }
}
finally {
    if ($null -ne $apiProcess -and -not $apiProcess.HasExited) { Stop-Process -Id $apiProcess.Id -Force }
    if ($postgresStarted) {
        & $dropdb '--if-exists' '-h' '127.0.0.1' '-p' "$DatabasePort" '-U' 'postgres' $databaseName | Out-Null
        & (Join-Path $postgresBin 'pg_ctl.exe') '-D' $dataDirectory '-m' 'fast' '-w' 'stop' | Out-Null
    }
    if ($mappingCreated) { & subst.exe 'T:' '/d' }
}
