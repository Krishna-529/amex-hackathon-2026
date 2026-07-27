@echo off
title ZKD Sites - Team ZKD
cd /d "C:\Users\HPW\Desktop\Amex GOAT\zkd-sites"

echo.
echo   Team ZKD - starting three sites
echo   ------------------------------------------------

for /f "tokens=2 delims=:" %%a in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.InterfaceAlias -notlike '*WSL*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } ^| Select-Object -First 1).IPAddress"') do set IP=%%a
if "%IP%"=="" powershell -NoProfile -Command "$i=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*WSL*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress; Write-Host ''; Write-Host ('   This machine : http://localhost:5173  5174  5175'); Write-Host ('   On your LAN  : http://' + $i + ':5173  5174  5175'); Write-Host ''"

echo   Ctrl+C twice to stop.
echo.
call npm run dev
pause
