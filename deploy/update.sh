#!/usr/bin/env bash
# ============================================================================
# Tau ERP — zero-downtime update script (run on the VPS inside the repo)
#   sudo bash deploy/update.sh
# Pulls latest code (if git), rebuilds, restarts the service, health-checks.
# The SQLite database is never touched by updates.
# ============================================================================
set -euo pipefail

INSTALL_DIR="/opt/tau-erp"
APP_NAME="tau-erp"
GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
ok() { echo -e "  ${GREEN}✔${NC} $1"; }
step() { echo -e "\n${CYAN}▶${NC} ${BOLD}$1${NC}"; }

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash deploy/update.sh"; exit 1; }

step "Pre-update database backup"
mkdir -p "$INSTALL_DIR/backups"
STAMP=$(date +%Y%m%d-%H%M%S)
if [[ -f "$INSTALL_DIR/db/custom.db" ]]; then
  sqlite3 "$INSTALL_DIR/db/custom.db" ".backup '$INSTALL_DIR/backups/custom-$STAMP.db'" 2>/dev/null \
    || cp "$INSTALL_DIR/db/custom.db" "$INSTALL_DIR/backups/custom-$STAMP.db"
  ok "Backup: backups/custom-$STAMP.db"
  # keep last 30 backups
  ls -1t "$INSTALL_DIR"/backups/custom-*.db 2>/dev/null | tail -n +31 | xargs -r rm -f
fi

step "Pulling latest code"
cd "$INSTALL_DIR"
if [[ -d .git ]]; then
  sudo -u tau git pull --ff-only && ok "Git pull OK" || { echo "Git pull failed — resolve manually"; exit 1; }
else
  ok "Not a git repo — assuming code was uploaded manually (skipping pull)"
fi

step "Rebuilding"
sudo -u tau -H bash -lc "
  set -e
  cd $INSTALL_DIR
  export NODE_OPTIONS=--max-old-space-size=2048
  bun install
  bunx prisma generate
  bun run build:standalone
"

step "Restarting service"
systemctl restart $APP_NAME
sleep 3

CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/ || true)
[[ "$CODE" == "200" ]] && ok "Health check passed (HTTP 200) — update complete ✔" \
                      || { echo "Health check FAILED (HTTP $CODE) — check: journalctl -u $APP_NAME -f"; exit 1; }
