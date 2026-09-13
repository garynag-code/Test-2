#!/usr/bin/env bash
# Starts the accounting platform for local development: the API on 5080 and the UI on 5173.
# Configuration comes from local.settings.sh, which is not committed.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
settings="$here/local.settings.sh"

if [[ ! -f "$settings" ]]; then
  cat > "$settings" <<'TEMPLATE'
# Local development settings. Not committed: it holds passwords.
export ConnectionStrings__AccountingDb="Host=localhost;Port=5432;Database=accounting_dev;Username=accounting;Password=CHANGE-ME"
export Bootstrap__AdministratorEmail="you@example.com"
export Bootstrap__AdministratorPassword="CHANGE-ME-12-CHARS"
TEMPLATE
  echo "Created $settings. Fill in your passwords, then run this script again."
  exit 0
fi

# shellcheck source=/dev/null
source "$settings"

if [[ "$ConnectionStrings__AccountingDb" == *CHANGE-ME* ]]; then
  echo "local.settings.sh still contains CHANGE-ME. Fill it in first."
  exit 1
fi

export ASPNETCORE_URLS="http://localhost:5080"

dotnet run --project "$here/src/Accounting.Api" --no-launch-profile &
api=$!
npm run dev --prefix "$here/src/Accounting.Web" &
web=$!

trap 'kill "$api" "$web" 2>/dev/null || true' EXIT INT TERM
echo "Open http://localhost:5173 once the API reports it is listening. Ctrl+C stops both."
wait
