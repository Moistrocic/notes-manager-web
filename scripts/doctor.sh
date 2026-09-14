#!/usr/bin/env bash
# =============================================================================
#  notes-manager-web - diagnostics
# =============================================================================
#  Read-only. Prints everything needed to find out why the panel cannot reach
#  OpenList (or why it is not running at all).
#
#      sudo ./scripts/doctor.sh
#      ./scripts/doctor.sh --dir /opt/notes-manager --service notes-manager
# =============================================================================
set -uo pipefail

INSTALL_DIR="/opt/notes-manager"
SERVICE_NAME="notes-manager"

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="${2:-$INSTALL_DIR}"; shift 2 ;;
    --service) SERVICE_NAME="${2:-$SERVICE_NAME}"; shift 2 ;;
    -h|--help)
      echo "usage: $0 [--dir /opt/notes-manager] [--service notes-manager]"
      exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

ENV_FILE="$INSTALL_DIR/.env"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi
head1() { printf '\n%s\n' "${BOLD}── $* ─────────────────────────────────${RESET}"; }
good()  { printf '  %s%s%s %s\n' "$GREEN" "[ok]" "$RESET" "$*"; }
bad()   { printf '  %s%s%s %s\n' "$RED" "[!!]" "$RESET" "$*"; }
note()  { printf '  %s%s%s %s\n' "$YELLOW" "[?]" "$RESET" "$*"; }
plain() { printf '      %s\n' "$*"; }

# read_env_value <file> <KEY> - same parsing rules as the application
read_env_value() {
  local file="$1" key="$2" line value
  [ -f "$file" ] || return 1
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1)" || return 1
  [ -n "$line" ] || return 1
  value="${line#*=}"
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
    *) value="${value%% #*}" ;;
  esac
  printf '%s' "$value"
}

mask() { # mask <value>
  if [ -z "${1:-}" ]; then printf '%s' '(not set)'; else printf '%s' "${1:0:4}..."; fi
}

show() { # show <label> <value>
  printf '      %-22s %s\n' "$1" "${2:-(empty)}"
}

printf '\n%s\n' "${BOLD}notes-manager-web - diagnostics${RESET}"
printf '%s\n' "${DIM}host: $(hostname 2>/dev/null || echo unknown)   date: $(date -u '+%Y-%m-%d %H:%M:%SZ')${RESET}"

head1 "1. this machine"
plain "hostname   : $(hostname 2>/dev/null || echo unknown)"
ips="$(hostname -I 2>/dev/null | tr -s ' ' | sed 's/^ //;s/ $//')"
plain "ip address : ${ips:-(unknown)}"
plain "127.0.0.1 here means THIS machine, not the computer running your browser."

head1 "2. configuration file"
if [ -f "$ENV_FILE" ]; then
  good "$ENV_FILE"
else
  bad "$ENV_FILE not found"
  note "pass --dir if the application is installed elsewhere"
fi

cfg() { read_env_value "$ENV_FILE" "$1" 2>/dev/null || true; }
PANEL_HOST="$(cfg HOST)"; PANEL_HOST="${PANEL_HOST:-0.0.0.0}"
PANEL_PORT="$(cfg PORT)"; PANEL_PORT="${PANEL_PORT:-8080}"
OPENLIST_URL="$(cfg OPENLIST_URL)"
OPENLIST_TOKEN="$(cfg OPENLIST_TOKEN)"

if [ -f "$ENV_FILE" ]; then
  show HOST "$PANEL_HOST"
  show PORT "$PANEL_PORT"
  show BASE_PATH "$(cfg BASE_PATH)"
  show STORAGE_DRIVER "$(cfg STORAGE_DRIVER)"
  show OPENLIST_URL "${OPENLIST_URL:-(empty - OpenList is not configured)}"
  show OPENLIST_TOKEN "$(mask "$OPENLIST_TOKEN")"
  show OPENLIST_ROOT "$(cfg OPENLIST_ROOT)"
  show DATA_DIR "$(cfg DATA_DIR)"
fi

head1 "3. systemd service"
if command -v systemctl >/dev/null 2>&1; then
  state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
  if [ "$state" = "active" ]; then good "$SERVICE_NAME: active"; else bad "$SERVICE_NAME: ${state:-unknown}"; fi
  plain "enabled: $(systemctl is-enabled "$SERVICE_NAME" 2>/dev/null || echo unknown)"
else
  note "systemctl not available"
fi

head1 "4. is the panel listening?"
# listeners <port> - the sockets listening on a port, using whichever tool exists
listeners() {
  local port="$1" re
  re="[:.]$port[^0-9]"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -E "$re" || true
  elif ! netstat -ltn >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -iE 'listen' | grep -E "$re" || true
  else
    netstat -ltn 2>/dev/null | grep -E "$re" || true
  fi
}
listening="$(listeners "$PANEL_PORT")"
if [ -n "$listening" ]; then
  good "something is listening on port $PANEL_PORT"
  printf '%s\n' "$listening" | while IFS= read -r l; do plain "$l"; done
else
  bad "nothing is listening on port $PANEL_PORT"
fi

head1 "5. the panel's own view"
health_url="http://127.0.0.1:$PANEL_PORT/api/system/health"
if command -v curl >/dev/null 2>&1; then
  body="$(curl -fsS --max-time 6 "$health_url" 2>&1)" && {
    good "GET $health_url"
    plain "$body"
  } || bad "GET $health_url failed: $body"
else
  note "curl not installed - skipping"
fi

head1 "6. can THIS machine reach OpenList?"
if [ -z "$OPENLIST_URL" ]; then
  bad "OPENLIST_URL is empty - the panel never tries to connect"
  note "set it in $ENV_FILE, then: systemctl restart $SERVICE_NAME"
else
  probe="${OPENLIST_URL%/}/api/public/init_status"
  plain "GET $probe"
  if command -v curl >/dev/null 2>&1; then
    stats="$(curl -sS -o /dev/null -w 'http %{http_code} in %{time_total}s' --max-time 8 "$probe" 2>/dev/null)"
    rc=$?
    if [ "$rc" -eq 0 ]; then
      good "reachable from this machine ($stats)"
    else
      bad "NOT reachable from this machine (curl exit $rc)"
      [ -n "$stats" ] && plain "$stats"
      curl -sS -o /dev/null --max-time 8 "$probe" 2>&1 | while IFS= read -r l; do plain "$l"; done
    fi
  else
    note "curl not installed - skipping"
  fi

  # what is bound to that port locally?
  ol_port="$(printf '%s' "$OPENLIST_URL" | sed -n 's|.*:\([0-9][0-9]*\)/\{0,1\}$|\1|p')"
  ol_host="$(printf '%s' "$OPENLIST_URL" | sed -e 's|^[a-z]*://||' -e 's|[:/].*$||')"
  if [ -n "$ol_port" ]; then
    head1 "7. local listeners on port $ol_port"
    bound="$(listeners "$ol_port")"
    if [ -n "$bound" ]; then
      good "port $ol_port is served here"
      printf '%s\n' "$bound" | while IFS= read -r l; do plain "$l"; done
    else
      bad "no local listener on port $ol_port"
      note "OpenList is probably running on a DIFFERENT machine, or in a container"
      note "with its own network namespace, or on another port"
    fi
  fi

  if [ "$ol_host" = "127.0.0.1" ] || [ "$ol_host" = "localhost" ]; then
    head1 "8. note about 127.0.0.1"
    plain "OPENLIST_URL uses $ol_host."
    plain "That address is resolved BY THE SERVER, not by your browser."
    plain "If your browser reaches OpenList at that address but the server does not,"
    plain "OpenList runs on your own computer - use the server's view of it instead:"
    plain "  - OpenList on another host:  OPENLIST_URL=http://<that-host>:5244"
    plain "  - OpenList on this host:     make sure it listens (see section 7)"
  fi
fi

printf '\n%s\n\n' "${DIM}report complete - the lines marked [!!] are the problem${RESET}"
