@echo off
REM Double-click this file to start Perch.
REM
REM Written for someone who has never used a command prompt: it checks what is
REM needed, installs the one missing piece if it has to, starts the app, and
REM opens it in the browser. Every failure explains itself in plain language.

cd /d "%~dp0.."

echo.
echo   Perch - booking manager
echo   =======================
echo.

REM --- 1. Is Python installed? ---------------------------------------------
set "PYTHON="
for %%P in ("py -3" "python" "python3") do (
    if not defined PYTHON (
        %%~P -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)" >nul 2>&1
        if not errorlevel 1 set "PYTHON=%%~P"
    )
)

if not defined PYTHON (
    echo   Perch needs Python, which isn't installed on this computer yet.
    echo.
    echo   It's free and takes about two minutes:
    echo.
    echo     1. The download page is opening in your browser now.
    echo     2. Download the big yellow button at the top.
    echo     3. Run the installer. IMPORTANT: tick the box that says
    echo        "Add Python to PATH" on the very first screen.
    echo     4. Come back and double-click this Start file again.
    echo.
    start "" "https://www.python.org/downloads/"
    echo   Press any key to close this window.
    pause >nul
    exit /b 1
)

REM --- 2. Is Flask installed? ----------------------------------------------
%PYTHON% -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo   Setting up ^(one time only, about 30 seconds^)...
    echo.
    %PYTHON% -m pip install --quiet --user "Flask>=2.3.0"
)

%PYTHON% -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo   Setup didn't finish - this is usually a blocked internet connection.
    echo   Try again on a different network, or send this window to whoever
    echo   helps you with computer things.
    echo.
    echo   Press any key to close this window.
    pause >nul
    exit /b 1
)

REM --- 3. Start it ----------------------------------------------------------
echo   Starting up...
start "" http://localhost:5000

echo.
echo   Perch is running. It should have opened in your browser.
echo   If it didn't, go to:  http://localhost:5000
echo.
echo   ---------------------------------------------------------
echo    TO STOP: close this window, or press Control and C.
echo    Leave this window open while you're using Perch.
echo   ---------------------------------------------------------
echo.

%PYTHON% -m bnb --demo --port 5000 --quiet
pause
