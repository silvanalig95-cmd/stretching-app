@echo off
rem Double-click on Windows to start Atlas.
cd /d "%~dp0"
python serve.py || py serve.py
pause
