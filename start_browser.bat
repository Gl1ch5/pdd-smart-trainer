@echo off
chcp 65001 >nul
title PDD Smart Trainer Launcher
echo Starting PDD Smart Trainer in default browser...
start "" "%~dp0index.html"
exit /b 0
