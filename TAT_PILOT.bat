@echo off
setlocal
cd /d "%~dp0"

echo [1/2] Dang dung BiddingFlow Pilot...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $listener) { Write-Host 'BiddingFlow khong chay tren cong 8000.'; exit 0 }; $app = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess); if (-not $app -or $app.Name -ne 'python.exe' -or $app.CommandLine -notmatch 'backend/app\.py') { Write-Error 'Cong 8000 khong thuoc BiddingFlow. Khong dung tien trinh.'; exit 2 }; $parent = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $app.ParentProcessId); if ($parent -and $parent.Name -eq 'powershell.exe' -and $parent.CommandLine -match 'run_demo_server\.ps1') { taskkill.exe /PID $parent.ProcessId /T /F | Out-Host } else { taskkill.exe /PID $app.ProcessId /T /F | Out-Host }"
if errorlevel 1 goto :app_error

echo [2/2] Dang dung Cloudflare Tunnel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'sc.exe' -Verb RunAs -Wait -ArgumentList 'stop','Cloudflared'"
if errorlevel 1 goto :cloudflare_error

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue).Status -eq 'Stopped') { exit 0 } else { exit 1 }"
if errorlevel 1 goto :cloudflare_error

echo.
echo Da tat BiddingFlow Pilot va Cloudflare Tunnel.
pause
exit /b 0

:app_error
echo.
echo Khong the dung BiddingFlow an toan. Cloudflare Tunnel chua bi tat.
pause
exit /b 2

:cloudflare_error
echo.
echo BiddingFlow da dung, nhung khong the dung Cloudflare Tunnel.
echo Hay chap nhan hop thoai Administrator va thu lai.
pause
exit /b 1
