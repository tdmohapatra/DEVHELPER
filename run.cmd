@echo off
REM One-click launcher for DevHelper.
REM Double-click this file. It runs run.ps1 bypassing the PowerShell execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
if %ERRORLEVEL% neq 0 pause
