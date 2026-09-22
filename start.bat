@echo off
cd /d "%~dp0"
title CC Desktop Pet Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing dependencies, downloading Electron ~100MB, please wait...
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check your network and retry.
    pause
    exit /b 1
  )
)

echo Starting CC... (right-click her to quit)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
