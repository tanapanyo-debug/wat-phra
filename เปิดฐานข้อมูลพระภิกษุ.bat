@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title wat-phra

if not exist "server\server.js" (
  echo Missing server\server.js next to this file.
  pause
  exit /b 1
)

netstat -ano | findstr /R ":4200 .*LISTENING" >nul
if not errorlevel 1 (
  echo Already running. Opening the browser.
  start "" "http://localhost:4200/"
  exit /b 0
)

if not exist "server\.env" (
  echo Creating server\.env and database wat_phra if needed.
  echo.
  cd /d "%~dp0server"
  node setup-env.js
  if errorlevel 1 (
    echo Setup failed. Check that PostgreSQL and Node.js are installed.
    pause
    exit /b 1
  )
  cd /d "%~dp0"
)

if not exist "server\node_modules" (
  echo Installing npm packages first time...
  cd /d "%~dp0server"
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
  cd /d "%~dp0"
)

echo ============================================================
echo   Monk database  http://localhost:4200
echo   Separate from accounting 4000 and audit 4100
echo   Keep this window open while using the app.
echo ============================================================
echo.
start /min "" powershell -NoProfile -Command "1..40 | ForEach-Object { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4200/api/health -TimeoutSec 1 | Out-Null; Start-Process 'http://localhost:4200/'; break } catch { Start-Sleep -Seconds 1 } }"
cd /d "%~dp0server"
node server.js
echo.
echo Closed.
pause
