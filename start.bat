@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VisualsHelper

set "PY="

where python >nul 2>nul
if %errorlevel% equ 0 (
  set "PY=python"
  goto :found
)

where py >nul 2>nul
if %errorlevel% equ 0 (
  set "PY=py"
  goto :found
)

if exist "D:\Softwares\Python\python.exe" (
  set "PY=D:\Softwares\Python\python.exe"
  goto :found
)

echo.
echo  [!] Python not found.
echo.
echo      Install Python from https://www.python.org/downloads/
echo      and tick "Add python.exe to PATH" during setup.
echo.
pause
exit /b 1

:found
%PY% "%~dp0serve.py"

echo.
echo Server stopped.
pause
