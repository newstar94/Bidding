@echo off
chcp 65001 >nul
title Diet Virus Macro Kangatang & mypersonnel - BiddingFlow

echo ======================================================================
echo    TIỆN ÍCH DIỆT VIRUS MACRO KANGATANG & MYPERSONNEL (EXCEL)
echo ======================================================================
echo.
echo Đang khởi chạy tiện ích với giao diện đồ họa...
echo.

python "%~dp0kangatang_cleaner.py"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [!] Gặp sự cố khi khởi chạy. Vui lòng kiểm tra lại môi trường Python.
    pause
)
