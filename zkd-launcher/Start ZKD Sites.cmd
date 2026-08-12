@echo off
title ZKD Sites - Team ZKD
rem Resolve relative to THIS script, never to one machine's Desktop. The previous
rem version did `cd /d "C:\Users\HPW\Desktop\Amex GOAT\zkd-sites"` and then
rem `npm run dev`, so it worked on exactly one laptop - and the zkd-sites\ path it
rem pointed at is empty in a fresh clone. The sibling launcher (zkd-website\Start
rem Website.cmd) already used %~dp0 correctly; this now matches it.
cd /d "%~dp0..\zkd-website"

if not exist "serve.js" (
  echo.
  echo   ERROR: cannot find "zkd-website\serve.js" next to this script.
  echo   Expected layout:  ^<repo^>\zkd-launcher\  and  ^<repo^>\zkd-website\
  echo.
  pause
  exit /b 1
)

echo.
echo   Team ZKD - starting three sites
echo   ------------------------------------------------

rem serve.js hosts the production builds and prints its own localhost + LAN URLs,
rem so there is no IP to detect or hardcode here.
echo   Ctrl+C to stop.
echo.
node serve.js
pause
