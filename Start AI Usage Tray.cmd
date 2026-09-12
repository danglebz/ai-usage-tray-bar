@echo off
rem Launches the tray app through Electron's own binary.
rem
rem Why not dist\AI Usage Tray.exe: Smart App Control (Windows Security -> App & browser
rem control) is enforced on this machine and blocks freshly built, unsigned executables -
rem the portable build starts, unpacks itself to %TEMP%, and the unpacked copy is killed.
rem electron.exe carries enough reputation to be allowed, so running the app through it
rem works without turning any Windows protection off.
rem Some editors (VS Code, and any terminal inside it) export ELECTRON_RUN_AS_NODE=1, which
rem would make electron.exe run as plain Node and die on the first Electron API call.
set "ELECTRON_RUN_AS_NODE="

rem %~dp0 ends in a backslash, which would escape the closing quote and mangle the path,
rem so the app directory is passed as "%~dp0." instead.
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
