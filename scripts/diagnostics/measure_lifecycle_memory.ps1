# Diagnostic reproduction only: never changes browser flags, deadlines or verdicts.
param([ValidateRange(1, 1800)][int]$MaxSamples = 900)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputRoot = Join-Path $repoRoot "data/logs"
$samplePath = Join-Path $outputRoot "prompt1-memory-$runStamp.jsonl"
$stdoutPath = Join-Path $outputRoot "prompt1-memory-$runStamp.stdout.log"
$stderrPath = Join-Path $outputRoot "prompt1-memory-$runStamp.stderr.log"

# Do not overlap another suite, or accidentally attach to an unrelated browser.
if (Get-CimInstance Win32_Process -Filter "Name = 'chrome-headless-shell.exe'") {
    throw "A headless browser is already running; leave it intact and inspect it first."
}
if (Get-NetTCPConnection -LocalPort 8010 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8010 is already in use; inspect the existing server first."
}
$suite = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    (Join-Path $repoRoot "scripts/run_isolated_audit_e2e.ps1"),
    "-Suite", "lifecycle", "-HostAddress", "127.0.0.2", "-Port", "8010"
) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
# Retain the process handle before exit so Windows can supply the exit status.
$null = $suite.Handle

Write-Output "Suite PID: $($suite.Id); samples: $samplePath"
Write-Output "Suite output: $stdoutPath; errors: $stderrPath"
$knownIds = [Collections.Generic.HashSet[uint32]]::new()
[void]$knownIds.Add([uint32]$suite.Id)
for ($sampleIndex = 0; $sampleIndex -lt $MaxSamples; $sampleIndex++) {
    $processes = @(Get-CimInstance Win32_Process)
    do {
        $added = $false
        foreach ($item in $processes) {
            if ($knownIds.Contains([uint32]$item.ParentProcessId)) {
                $added = $knownIds.Add([uint32]$item.ProcessId) -or $added
            }
        }
    } while ($added)
    $memory = Get-CimInstance Win32_PerfRawData_PerfOS_Memory
    $rows = @($processes | Where-Object { $knownIds.Contains([uint32]$_.ProcessId) } | ForEach-Object {
        # Never persist command lines, environment, page contents or session state.
        [ordered]@{
            pid = $_.ProcessId
            parentPid = $_.ParentProcessId
            name = $_.Name
            created = $_.CreationDate.ToUniversalTime().ToString("o")
            privateBytes = [uint64]$_.PrivatePageCount
            workingSetBytes = [uint64]$_.WorkingSetSize
            virtualBytes = [uint64]$_.VirtualSize
            peakPagefileKiB = [uint64]$_.PeakPageFileUsage
        }
    })
    [ordered]@{
        utc = [DateTime]::UtcNow.ToString("o")
        committedBytes = [uint64]$memory.CommittedBytes
        commitLimitBytes = [uint64]$memory.CommitLimit
        availableBytes = [uint64]$memory.AvailableBytes
        processes = $rows
    } | ConvertTo-Json -Depth 4 -Compress | Add-Content -LiteralPath $samplePath -Encoding UTF8
    $suite.Refresh()
    if ($suite.HasExited) {
        $suite.WaitForExit()
        $suiteExitCode = $suite.ExitCode
        if ($null -eq $suiteExitCode) {
            Write-Error "Suite exited but its status could not be read; no passing verdict is available."
            exit 1
        }
        Write-Output "Suite finished with exit code $suiteExitCode."
        exit $suiteExitCode
    }
    Start-Sleep -Seconds 1 # Sampling cadence only, never a test synchronization wait.
}
Write-Output "Observation bound reached; suite PID $($suite.Id) was NOT stopped. Inspect the live process before taking further action."
exit 2
