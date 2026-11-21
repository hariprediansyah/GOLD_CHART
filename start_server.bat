@echo off
cd /d "%~dp0"
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js diperlukan untuk data Dukascopy. Install dari https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\dukascopy-node" (
  echo Menginstal dukascopy-node…
  call npm install
)
echo XAUUSD Chart · Dukascopy: http://127.0.0.1:8792
set GOLD_PORT=8792
"%PY%" backend\main.py
pause
