@echo off
rem Starts Olympus so that other devices on your home network can use it too (log-in required).
rem Double-click it. Close the window to stop the server.
setlocal
cd /d "%~dp0"

if not exist network-settings.bat (
  copy network-settings.example.bat network-settings.bat >nul
  echo.
  echo First time: I made network-settings.bat for you. Notepad will open.
  echo Change the password, and put this PC's address on the UNFURL_ALLOWED_HOSTS line. Save, close Notepad,
  echo then double-click start-network.bat again.
  echo.
  notepad network-settings.bat
  pause
  exit /b 1
)
call network-settings.bat

echo %UNFURL_AUTH% | find "CHANGE-THIS" >nul
if not errorlevel 1 (
  echo.
  echo Please choose your own password first: open network-settings.bat in Notepad and change CHANGE-THIS-PASSWORD.
  echo.
  notepad network-settings.bat
  pause
  exit /b 1
)

set "PY="
python --version >nul 2>nul && set "PY=python"
if not defined PY py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY (
  echo.
  echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH" in the installer.
  echo.
  pause
  exit /b 1
)

if "%UNFURL_AUTO_PULL%"=="1" if exist ".git" (
  where git >nul 2>nul && (
    echo Checking GitHub for a newer version...
    git pull --ff-only
  )
)

echo.
set "PORTSUFFIX=:%UNFURL_PORT%"
if "%UNFURL_PORT%"=="80" set "PORTSUFFIX="
echo Olympus will be reachable at:
echo     http://%COMPUTERNAME%%PORTSUFFIX%/
echo   or, using this PC's address ^(look for "IPv4"^), for example http://192.168.1.50%PORTSUFFIX%/
ipconfig | findstr /c:"IPv4"
echo   Log in with the name and password from network-settings.bat.
echo.
%PY% serve.py --no-open
echo.
echo The server has stopped.
pause
