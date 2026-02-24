@echo off
setlocal
title Bastion Browser Launcher

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Bastion] Node.js was not found on this machine.
  echo [Bastion] Install Node.js LTS from https://nodejs.org/ and run this launcher again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [Bastion] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [Bastion] npm install failed.
    pause
    exit /b 1
  )
)

echo [Bastion] Launching browser...
set ELECTRON_RUN_AS_NODE=
call npm start

endlocal
