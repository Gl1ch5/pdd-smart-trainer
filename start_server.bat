@echo off
setlocal
cd /d "%~dp0"
title PDD Smart Trainer (Backend + Web)
echo ========================================================
echo   Starting PDD Smart Trainer Server on http://localhost:5050
echo ========================================================
start "" "http://localhost:5050"
python server.py
endlocal
