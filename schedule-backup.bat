@echo off
rem Makes the backup run by itself every day (default 12:30), using backup-docker.bat.
rem If the PC was off at that time it runs as soon as you are signed in again. Choose the backup folder first by
rem double-clicking backup-docker.bat once. To stop it again:  schtasks /Delete /TN "Unfurl backup" /F
setlocal
cd /d "%~dp0"
set "AT=12:30"
if not exist deploy\backup-folder.txt (
  echo Please double-click backup-docker.bat first: it asks which folder to save the backups in.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $a = New-ScheduledTaskAction -Execute '%~dp0backup-docker.bat' -Argument 'auto' -WorkingDirectory '%~dp0'; $t = New-ScheduledTaskTrigger -Daily -At '%AT%'; $s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName 'Unfurl backup' -Action $a -Trigger $t -Settings $s -Force | Out-Null"
if errorlevel 1 (
  echo.
  echo Could not create the daily task. Send me the message above.
  pause
  exit /b 1
)
echo.
echo Done: a backup now runs every day at %AT% (or as soon as possible after that). The result of the last run is in deploy\backup-last.txt.
pause
