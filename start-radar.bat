@echo off
chcp 65001 >nul
title Global Hackathon Radar - San Hackathon Toan Cau
echo ========================================================
echo   GLOBAL HACKATHON RADAR - KHOI DONG SERVER...
echo   Truy cap ngay tai: http://localhost:4567
echo ========================================================
cd /d "%~dp0"
start "" "http://localhost:4567"
node server.mjs
pause
