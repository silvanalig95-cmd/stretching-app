@echo off
rem Makes Palaestra start by itself (minimised) whenever you sign in to Windows, so other devices can reach it
rem without you doing anything. Double-click once. No administrator rights needed.
rem To undo: delete the file  %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Unfurl.bat
setlocal
cd /d "%~dp0"
if not exist network-settings.bat (
  echo Run start-network.bat once first, so your settings exist.
  pause
  exit /b 1
)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\Unfurl.bat" echo @start "Unfurl" /min "%~dp0start-network.bat"
if errorlevel 1 (
  echo.
  echo Could not write to the Startup folder: %STARTUP%
) else (
  echo.
  echo Done. Palaestra will start minimised each time you sign in.
  echo To undo, delete: %STARTUP%\Unfurl.bat
)
pause
