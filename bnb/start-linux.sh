#!/bin/bash
# Run this file to start Perch (double-click, or: bash bnb/start-linux.sh).
#
# Written for someone who has never used a terminal: it checks what is needed,
# installs the one missing piece if it has to, starts the app, and opens it in
# the browser.  Every failure explains itself in plain language instead of
# printing an error code.

cd "$(dirname "$0")/.." || exit 1

echo ""
echo "  Perch — booking manager"
echo "  ======================="
echo ""

# --- 1. Is Python installed? -------------------------------------------------
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then
      PYTHON="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo "  Perch needs Python, which isn't installed on this computer yet."
  echo ""
  echo "  It's free and takes about two minutes:"
  echo ""
  echo "    1. The download page is opening in your browser now."
  echo "    2. Download the big yellow button at the top."
  echo "    3. Open the file you downloaded and click through the installer."
  echo "    4. Come back and double-click this Start file again."
  echo ""
  xdg-open "https://www.python.org/downloads/" 2>/dev/null
  echo "  Press Enter to close this window."
  read -r _
  exit 1
fi

# --- 2. Is Flask installed? --------------------------------------------------
if ! "$PYTHON" -c "import flask" >/dev/null 2>&1; then
  echo "  Setting up (one time only, about 30 seconds)..."
  echo ""
  if ! "$PYTHON" -m pip install --quiet --user "Flask>=2.3.0" 2>/dev/null; then
    # Some Python installs refuse --user; fall back to a private folder so we
    # never need an administrator password.
    "$PYTHON" -m venv .perch-env >/dev/null 2>&1
    if [ -x ".perch-env/bin/python" ]; then
      PYTHON=".perch-env/bin/python"
      "$PYTHON" -m pip install --quiet "Flask>=2.3.0"
    fi
  fi
fi

if ! "$PYTHON" -c "import flask" >/dev/null 2>&1; then
  echo "  Setup didn't finish — this is usually a blocked internet connection."
  echo "  Try again on a different network, or send this window to whoever"
  echo "  helps you with computer things."
  echo ""
  echo "  Press Enter to close this window."
  read -r _
  exit 1
fi

# --- 3. Start it -------------------------------------------------------------
echo "  Starting up..."
"$PYTHON" -m bnb --demo --port 5000 --quiet > .perch-log.txt 2>&1 &
SERVER_PID=$!

# Wait for it to answer before opening the browser, so the first page is never
# a "can't connect" error.
STARTED=""
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:5000/healthz" 2>/dev/null; then
    STARTED="yes"
    break
  fi
  sleep 0.5
done

if [ -z "$STARTED" ]; then
  echo ""
  echo "  Perch didn't manage to start. The most common reason is that it's"
  echo "  already running in another window — check for one before anything"
  echo "  else. The technical details are below and in the file .perch-log.txt"
  echo "  if you need to pass them on."
  echo ""
  cat .perch-log.txt 2>/dev/null | tail -20
  echo ""
  echo "  Press Enter to close this window."
  read -r _
  kill $SERVER_PID 2>/dev/null
  exit 1
fi

xdg-open "http://localhost:5000" 2>/dev/null

echo ""
echo "  Perch is running. It should have opened in your browser."
echo "  If it didn't, go to:  http://localhost:5000"
echo ""
echo "  ---------------------------------------------------------"
echo "   TO STOP: close this window, or press Control and C."
echo "   Leave this window open while you're using Perch."
echo "  ---------------------------------------------------------"
echo ""

trap 'kill $SERVER_PID 2>/dev/null' EXIT
wait $SERVER_PID
