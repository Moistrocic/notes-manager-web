#!/usr/bin/env bash
# =============================================================================
#  notes-manager-web - uninstaller for Linux servers
# =============================================================================
#  Usage:
#      sudo ./scripts/uninstall.sh              # remove the service + program files
#      sudo ./scripts/uninstall.sh --purge      # also delete data, config and user
# =============================================================================
set -Eeuo pipefail

SERVICE_NAME="notes-manager"
DEFAULT_INSTALL_DIR="/opt/notes-manager"
DEFAULT_DATA_DIR="/var/lib/notes-manager"
DEFAULT_CONFIG_DIR="/etc/notes-manager"

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""
fi

step()  { printf '%s\n' "${C_BOLD}==>${C_RESET} ${C_BOLD}$*${C_RESET}"; }
ok()    { printf '%s\n' "${C_GREEN}[ok]${C_RESET} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}[!]${C_RESET} $*"; }
die()   { printf '%s\n' "${C_RED}[error]${C_RESET} $*" >&2; exit 1; }

PURGE="0"
KEEP_SERVICE_USER="0"
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE="1"; shift ;;
    --keep-user) KEEP_SERVICE_USER="1"; shift ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --data) DATA_DIR="${2:-}"; shift 2 ;;
    --config) CONFIG_DIR="${2:-}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-}"; shift 2 ;;
    -h|--help)
      cat <<'USAGE_EOF'
notes-manager-web uninstaller

Usage: sudo ./scripts/uninstall.sh [options]

Options:
  --purge         Also delete the data directory, the configuration and the system user
  --keep-user     Keep the system user even with --purge
  --dir PATH      Install directory  (default /opt/notes-manager)
  --data PATH     Data directory     (default /var/lib/notes-manager)
  --config PATH   Config directory   (default /etc/notes-manager)
  --service NAME  systemd unit name  (default notes-manager)
  -h, --help      Show this help
USAGE_EOF
      exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
DATA_DIR="${DATA_DIR:-$DEFAULT_DATA_DIR}"
CONFIG_DIR="${CONFIG_DIR:-$DEFAULT_CONFIG_DIR}"
SERVICE_USER="notes-manager"

if [ "$(id -u)" -ne 0 ]; then
  die "please run as root: sudo $0 ..."
fi

printf '\n%s\n\n' "${C_BOLD}notes-manager-web - uninstaller${C_RESET}"

# 1. stop + disable --------------------------------------------------------- #
if command -v systemctl >/dev/null 2>&1; then
  step "stopping the service"
  systemctl stop "$SERVICE_NAME" 2>/dev/null && ok "service stopped" || warn "service was not running"
  systemctl disable "$SERVICE_NAME" 2>/dev/null && ok "service disabled" || true
  UNIT_FILE="/etc/systemd/system/$SERVICE_NAME.service"
  if [ -f "$UNIT_FILE" ]; then
    rm -f "$UNIT_FILE"
    systemctl daemon-reload
    systemctl reset-failed "$SERVICE_NAME" 2>/dev/null || true
    ok "systemd unit removed"
  else
    warn "no unit file at $UNIT_FILE"
  fi
else
  warn "systemctl not found - skipping service management"
fi

# 2. program files ---------------------------------------------------------- #
step "removing the program files"
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
  ok "removed $INSTALL_DIR"
else
  warn "$INSTALL_DIR does not exist"
fi

# 3. configuration ---------------------------------------------------------- #
if [ "$PURGE" = "1" ]; then
  step "removing the configuration"
  rm -f "$CONFIG_DIR/notes-manager.env"
  rmdir "$CONFIG_DIR" 2>/dev/null && ok "removed $CONFIG_DIR" || warn "$CONFIG_DIR kept (not empty)"

  step "removing the data directory"
  if [ -d "$DATA_DIR" ]; then
    printf '%s' "  This deletes every locally stored note in $DATA_DIR. Continue? [y/N] "
    read -r answer < /dev/tty || answer="n"
    case "$answer" in
      y|Y|yes|YES)
        rm -rf "$DATA_DIR"
        ok "removed $DATA_DIR"
        ;;
      *) warn "data directory kept" ;;
    esac
  fi

  if [ "$KEEP_SERVICE_USER" != "1" ] && id -u "$SERVICE_USER" >/dev/null 2>&1; then
    userdel "$SERVICE_USER" 2>/dev/null && ok "removed user $SERVICE_USER" || warn "could not remove user $SERVICE_USER"
  fi
else
  warn "keeping configuration ($CONFIG_DIR) and data ($DATA_DIR) - use --purge to delete them"
fi

printf '\n%s\n\n' "${C_GREEN}${C_BOLD}卸载完成 / Uninstall complete${C_RESET}"
exit 0
