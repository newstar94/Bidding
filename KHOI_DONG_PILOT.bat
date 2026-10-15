@echo off
setlocal
cd /d "%~dp0"

echo [1/2] Dang khoi dong Cloudflare Tunnel...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'sc.exe' -Verb RunAs -Wait -ArgumentList 'start','Cloudflared'"
if errorlevel 1 goto :cloudflare_error

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue).Status -eq 'Running') { exit 0 } else { exit 1 }"
if errorlevel 1 goto :cloudflare_error

echo [2/2] Dang khoi dong BiddingFlow Pilot...
echo Website: https://demo.hosodauthau.online
echo Giu cua so nay mo trong thoi gian van hanh pilot.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_demo_server.ps1"
set "APP_EXIT=%ERRORLEVEL%"

if not "%APP_EXIT%"=="0" (
    echo.
    echo BiddingFlow da dung voi ma loi %APP_EXIT%.
    pause
)
exit /b %APP_EXIT%

:cloudflare_error
echo.
echo Khong the khoi dong Cloudflare Tunnel.
echo Hay chap nhan hop thoai Administrator va thu lai.
pause
exit /b 1
