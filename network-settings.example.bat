@echo off
rem Settings for sharing Unfurl with other devices on your home network.
rem start-network.bat copies this file to network-settings.bat the first time; edit THAT copy (it is never overwritten or uploaded).
rem Keep the quotes exactly as they are. Avoid these characters in the password:  &  ^  %  "  <  >  |

rem Who may log in: "name:password". The server refuses to share without one.
set "UNFURL_AUTH=me:CHANGE-THIS-PASSWORD"

rem The names you will type in a browser to reach this PC. %COMPUTERNAME% is this PC's name; add its
rem address too (find it with:  ipconfig  ->  "IPv4 Address", something like 192.168.1.50), separated by commas.
set "UNFURL_ALLOWED_HOSTS=%COMPUTERNAME%,192.168.1.50"

set "UNFURL_HOST=0.0.0.0"
rem 80 is the web's default port, so addresses need no ":8765" at the end. If something else on this PC already uses port 80
rem (the server then says so), change it to 8765 and type http://yourpc:8765 instead.
set "UNFURL_PORT=80"

rem Set to 1 to fetch the newest version from GitHub each time the server starts (needs Git for Windows and a folder made with "git clone").
set "UNFURL_AUTO_PULL=0"
