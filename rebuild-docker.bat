@echo off
rem Brings this folder's Docker recipe up to date from GitHub and rebuilds the Palaestra container.
rem Needed only now and then, when the container recipe itself changed (I will say so). The app's own updates arrive by themselves.
rem Your settings (deploy\unfurl.env) and your data are NOT touched. Double-click it with Docker Desktop running.
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found. Start Docker Desktop, wait for "Engine running", and try again.
  pause
  exit /b 1
)

set "BRANCH=claude/sharp-cray-hko5xu"
if exist deploy\unfurl.env (
  for /f "tokens=1,* delims==" %%a in ('findstr /b "UNFURL_BRANCH=" deploy\unfurl.env') do set "BRANCH=%%b"
)
set "ZIP=%TEMP%\unfurl-latest.zip"
set "OUT=%TEMP%\unfurl-latest"
set "URL=https://github.com/silvanalig95-cmd/stretching-app/archive/refs/heads/%BRANCH%.zip"

echo Downloading the newest recipe (%BRANCH%) from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest $env:URL -OutFile $env:ZIP; if (Test-Path $env:OUT) { Remove-Item $env:OUT -Recurse -Force }; Expand-Archive $env:ZIP -DestinationPath $env:OUT; $src = (Get-ChildItem $env:OUT | Select-Object -First 1).FullName; Copy-Item (Join-Path $src '*') '%~dp0' -Recurse -Force"
if errorlevel 1 (
  echo.
  echo The download did not work. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo Rebuilding the Palaestra container. This takes a few minutes the first time...
docker compose -f deploy/docker-compose.yml up -d --build
if errorlevel 1 (
  echo.
  echo The rebuild failed. Send me the last lines above.
  pause
  exit /b 1
)
echo.
echo Done. Open http://localhost/ ; the footer shows the version and build.
pause
