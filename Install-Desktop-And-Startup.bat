@echo off
chcp 65001 >nul
title Cai dat Hackathon Radar Desktop App
echo ==============================================================
echo   CAI DAT HACKATHON RADAR THANH UNG DUNG WINDOWS (DESKTOP + STARTUP)
echo ==============================================================
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$exe = Join-Path (Get-Location) 'HackathonRadar.exe'; " ^
  "$ico = Join-Path (Get-Location) 'radar-icon.ico'; " ^
  "$desk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Hackathon Radar.lnk'; " ^
  "$s1 = $ws.CreateShortcut($desk); $s1.TargetPath = $exe; $s1.WorkingDirectory = (Get-Location).Path; $s1.IconLocation = $ico; $s1.Save(); " ^
  "$start = Join-Path ([Environment]::GetFolderPath('Startup')) 'Hackathon Radar.lnk'; " ^
  "$s2 = $ws.CreateShortcut($start); $s2.TargetPath = $exe; $s2.Arguments = '--background'; $s2.WorkingDirectory = (Get-Location).Path; $s2.IconLocation = $ico; $s2.Save();"

echo.
echo [OK] Da tao bieu tuong "Hackathon Radar" ngay ngoai Man hinh chinh (Desktop)!
echo [OK] Da bat che do Tu khoi dong ngam & ban thong bao moi khi mo may Windows!
echo.
echo Dang khoi chay HackathonRadar.exe ngay bay gio...
start "" "%~dp0HackathonRadar.exe"
timeout /t 3 >nul
