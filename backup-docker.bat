@echo off
rem Saves a dated .zip of ALL your Palaestra data (every login's library, history, ratings and key) into an ordinary folder,
rem plus a copy of your settings file, so Proton Drive (or any other backup tool) can take it from there.
rem   backup-docker.bat          double-click: asks ONCE which folder to use, then makes a backup
rem   backup-docker.bat auto     the scheduled daily run: never asks, never waits for a key (result in deploy\backup-last.txt)
rem   backup-docker.bat folder   choose a different folder
rem The guide, including how to get everything back: deploy\BACKUP.md
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set "MODE=%~1"
set "CFG=deploy\backup-folder.txt"
set "LOG=deploy\backup-last.txt"

if /i "%MODE%"=="auto" (
  call :go >"%LOG%" 2>&1
  exit /b !errorlevel!
)
call :go
set "RC=!errorlevel!"
echo.
pause
exit /b !RC!

:go
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found. Start Docker Desktop, wait for "Engine running", and try again.
  exit /b 1
)
docker info >nul 2>nul
if errorlevel 1 (
  echo Docker is installed but not running. Start Docker Desktop, wait for "Engine running", and try again.
  exit /b 1
)

set "DEST="
if exist "%CFG%" if /i not "%MODE%"=="folder" set /p DEST=<"%CFG%"
if not defined DEST (
  if /i "%MODE%"=="auto" (
    echo No backup folder has been chosen yet. Double-click backup-docker.bat once to choose it.
    exit /b 1
  )
  echo Where should the backups go? Paste the full path of a folder, for example one inside your Proton Drive folder.
  set /p DEST=Folder: 
)
if not defined DEST (
  echo No folder given.
  exit /b 1
)
set "DEST=!DEST:"=!"
if "!DEST:~-1!"=="\" set "DEST=!DEST:~0,-1!"
if not exist "!DEST!\" mkdir "!DEST!" 2>nul
if not exist "!DEST!\" (
  echo Could not use the folder "!DEST!".
  exit /b 1
)
>"%CFG%" echo(!DEST!

echo Saving your Palaestra data to "!DEST!" ...
docker compose -f deploy\docker-compose.yml run --rm -T --no-deps -v "!DEST!:/backup" --entrypoint python3 unfurl /srv/unfurl/current/serve.py --backup /backup
if errorlevel 1 (
  echo.
  echo The backup did not work. If the message above says it cannot open serve.py or does not know --backup,
  echo this copy of Palaestra has not fetched the newest version yet: run rebuild-docker.bat once, then try again.
  exit /b 1
)
if exist deploy\unfurl.env (
  copy /y deploy\unfurl.env "!DEST!\unfurl.env" >nul
  echo Also copied your settings file ^(deploy\unfurl.env: logins and server key^) next to it.
)
echo.
echo Done. In that folder you will find unfurl-backup-YYYY-MM-DD.zip, one per day, the newest 14 kept.
exit /b 0
