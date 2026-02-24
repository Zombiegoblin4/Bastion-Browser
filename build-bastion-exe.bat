@echo off
setlocal
title Bastion Browser EXE Builder

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Bastion] Node.js was not found on this machine.
  echo [Bastion] Install Node.js LTS from https://nodejs.org/ and run this script again.
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

echo [Bastion] Building installer and portable EXE...
set ELECTRON_RUN_AS_NODE=
call npm run dist
if errorlevel 1 (
  echo [Bastion] Build failed.
  pause
  exit /b 1
)

echo [Bastion] Build complete. Check the dist folder.
pause

endlocal
