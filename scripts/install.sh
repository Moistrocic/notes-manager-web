#!/usr/bin/env bash
# =============================================================================
#  notes-manager-web - one-click installer for Linux servers
# =============================================================================
#  Usage (from the project directory):
#      sudo ./scripts/install.sh
#      sudo ./scripts/install.sh --port 8080 --openlist-url http://127.0.0.1:5244
#
#  Run with --help for the full option list.
# =============================================================================
set -Eeuo pipefail

APP_NAME="notes-manager"
SERVICE_NAME="notes-manager"
DEFAULT_INSTALL_DIR="/opt/notes-manager"
DEFAULT_DATA_DIR="/var/lib/notes-manager"
DEFAULT_CONFIG_DIR="/etc/notes-manager"
DEFAULT_PORT="8080"
NODE_MAJOR="22"
NODE_MIN_MAJOR="20"
NODE_MIN_MINOR="19"

# --------------------------------------------------------------------------- #
# Pretty printing                                                             #
# --------------------------------------------------------------------------- #
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

info()  { printf '%s\n' "${C_BLUE}*${C_RESET} $*"; }
step()  { printf '%s\n' "${C_BOLD}${C_BLUE}==>${C_RESET} ${C_BOLD}$*${C_RESET}"; }
ok()    { printf '%s\n' "${C_GREEN}[ok]${C_RESET} $*"; }
warn()  { printf '%s\n' "${C_YELLOW}[!]${C_RESET} $*"; }
die()   { printf '%s\n' "${C_RED}[error]${C_RESET} $*" >&2; exit 1; }
trap 'die "installation failed at line $LINENO"' ERR

# --------------------------------------------------------------------------- #
# Defaults / arguments                                                        #
# --------------------------------------------------------------------------- #
INSTALL_DIR="${NOTES_MANAGER_DIR:-$DEFAULT_INSTALL_DIR}"
DATA_DIR="${NOTES_MANAGER_DATA:-$DEFAULT_DATA_DIR}"
CONFIG_DIR="${NOTES_MANAGER_CONFIG:-$DEFAULT_CONFIG_DIR}"
SERVICE_USER="${NOTES_MANAGER_USER:-$APP_NAME}"
PORT="${NOTES_MANAGER_PORT:-$DEFAULT_PORT}"
HOST="0.0.0.0"
BASE_PATH=""
PUBLIC_URL=""
STORAGE_DRIVER="auto"
OPENLIST_URL=""
OPENLIST_TOKEN=""
OPENLIST_ROOT="/notes"
OPENLIST_PER_USER="false"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD=""
AUTH_LOCAL_ENABLED="true"
SKIP_BUILD="0"
SKIP_DEPS="0"
FORCE_NODE="0"
START_SERVICE="1"

usage() {
  cat <<'USAGE_EOF'
notes-manager-web installer

Usage: sudo ./scripts/install.sh [options]

Options:
  --dir PATH              Install directory                 (default /opt/notes-manager)
  --data PATH             Data directory (notes, sessions) (default /var/lib/notes-manager)
  --config PATH           Config directory                 (default /etc/notes-manager)
  --user NAME             System user to run the service   (default notes-manager)
  --port PORT             HTTP port                        (default 8080)
  --host ADDR             Bind address                     (default 0.0.0.0)
  --base-path PATH        Serve under a sub path, e.g. /notes
  --public-url URL        Public URL behind a reverse proxy
  --driver MODE           auto | openlist | local          (default auto)
  --openlist-url URL      OpenList base URL, e.g. http://127.0.0.1:5244
  --openlist-token TOKEN  OpenList API token (Settings -> API)
  --openlist-root PATH    Notes root inside OpenList       (default /notes)
  --openlist-per-user     Store each user's notes in <root>/<username>
  --admin-user NAME       Local administrator username     (default admin)
  --admin-password PASS   Local administrator password     (random when omitted)
  --no-local-auth         Only allow OpenList accounts
  --skip-build            Do not run the front-end build
  --skip-deps             Do not run npm install
  --force-node            Install Node.js even when a suitable version exists
  --no-start              Install without starting the service
  -h, --help              Show this help

Environment variables with the NOTES_MANAGER_ prefix are honoured as well, e.g.
  NOTES_MANAGER_PORT=9000 sudo -E ./scripts/install.sh
USAGE_EOF
}

need_value() {
  [ -n "$2" ] || die "option $1 requires a value"
  printf '%s' "$2"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) INSTALL_DIR="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --data) DATA_DIR="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --config) CONFIG_DIR="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --user) SERVICE_USER="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --port) PORT="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --host) HOST="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --base-path) BASE_PATH="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --public-url) PUBLIC_URL="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --driver) STORAGE_DRIVER="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --openlist-url) OPENLIST_URL="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --openlist-token) OPENLIST_TOKEN="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --openlist-root) OPENLIST_ROOT="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --openlist-per-user) OPENLIST_PER_USER="true"; shift ;;
    --admin-user) ADMIN_USERNAME="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="$(need_value "$1" "${2:-}")"; shift 2 ;;
    --no-local-auth) AUTH_LOCAL_ENABLED="false"; shift ;;
    --skip-build) SKIP_BUILD="1"; shift ;;
    --skip-deps) SKIP_DEPS="1"; shift ;;
    --force-node) FORCE_NODE="1"; shift ;;
    --no-start) START_SERVICE="0"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

case "$STORAGE_DRIVER" in
  auto|openlist|local) ;;
  *) die "--driver must be one of: auto, openlist, local" ;;
esac

# --------------------------------------------------------------------------- #
# Preconditions                                                               #
# --------------------------------------------------------------------------- #
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC_DIR/package.json" ] || die "package.json not found in $SRC_DIR - run this script from the project"
[ -f "$SRC_DIR/server/package.json" ] || die "server/ not found in $SRC_DIR"

# Fail fast - and with a useful message - when the checkout is incomplete.
# (A missing source file otherwise surfaces as a wall of TypeScript errors.)
missing=""
for required in \
  server/src/index.ts \
  server/src/integrations/openlist/client.ts \
  server/src/storage/manager.ts \
  server/src/notes/repository.ts \
  web/src/main.tsx \
  web/src/App.tsx \
  web/package.json; do
  [ -f "$SRC_DIR/$required" ] || missing="$missing\n    - $required"
done
if [ -n "$missing" ]; then
  printf '%b\n' "«C_RED»[error]«C_RESET» the source tree in $SRC_DIR is incomplete:$missing" >&2
  die "update the checkout (git pull) and run the installer again"
fi

if [ "$(id -u)" -ne 0 ]; then
  die "please run as root: sudo $0 ..."
fi

if ! command -v systemctl >/dev/null 2>&1; then
  die "systemd is required (systemctl not found)"
fi

printf '\n%s\n' "${C_BOLD}notes-manager-web - installer${C_RESET}"
printf '%s\n\n' "${C_DIM}source: $SRC_DIR${C_RESET}"

# --------------------------------------------------------------------------- #
# Package manager helpers                                                     #
# --------------------------------------------------------------------------- #
PKG=""
detect_pkg() {
  for candidate in apt-get dnf yum zypper pacman apk; do
    if command -v "$candidate" >/dev/null 2>&1; then PKG="$candidate"; return 0; fi
  done
  return 1
}
pkg_install() {
  [ -n "$PKG" ] || detect_pkg || die "no supported package manager found"
  case "$PKG" in
    apt-get) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" ;;
    dnf|yum) "$PKG" install -y "$@" ;;
    zypper) zypper --non-interactive install "$@" ;;
    pacman) pacman -Sy --noconfirm "$@" ;;
    apk) apk add --no-cache "$@" ;;
  esac
}
pkg_update() {
  [ -n "$PKG" ] || detect_pkg || return 0
  case "$PKG" in
    apt-get) DEBIAN_FRONTEND=noninteractive apt-get update -qq ;;
    dnf|yum) "$PKG" makecache -q ;;
    zypper) zypper --non-interactive refresh ;;
    pacman) pacman -Sy --noconfirm ;;
    apk) apk update ;;
  esac
}

# --------------------------------------------------------------------------- #
# Node.js                                                                     #
# --------------------------------------------------------------------------- #
node_is_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local version major minor
  version="$(node -v | sed 's/^v//')"
  major="${version%%.*}"
  minor="$(printf '%s' "$version" | cut -d. -f2)"
  [ "$major" -gt "$NODE_MIN_MAJOR" ] && return 0
  [ "$major" -eq "$NODE_MIN_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ] && return 0
  return 1
}

install_node_tarball() {
  local arch node_arch tmp url
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) node_arch="linux-x64" ;;
    aarch64|arm64) node_arch="linux-arm64" ;;
    armv7l) node_arch="linux-armv7l" ;;
    *) die "unsupported CPU architecture: $arch" ;;
  esac
  info "downloading the official Node.js $NODE_MAJOR LTS build ($node_arch)"
  tmp="$(mktemp -d)"
  if command -v curl >/dev/null 2>&1; then
    url="$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/" | grep -o "node-v[0-9.]*-$node_arch\.tar\.xz" | head -n1)"
    [ -n "$url" ] || die "could not determine the latest Node.js version"
    curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$url" -o "$tmp/node.tar.xz"
  elif command -v wget >/dev/null 2>&1; then
    url="$(wget -qO- "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/" | grep -o "node-v[0-9.]*-$node_arch\.tar\.xz" | head -n1)"
    [ -n "$url" ] || die "could not determine the latest Node.js version"
    wget -qO "$tmp/node.tar.xz" "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$url"
  else
    pkg_install curl
    install_node_tarball
    return 0
  fi
  tar -xJf "$tmp/node.tar.xz" -C "$tmp"
  local extracted
  extracted="$(find "$tmp" -maxdepth 1 -type d -name 'node-v*' | head -n1)"
  [ -n "$extracted" ] || die "failed to extract Node.js"
  rm -rf /usr/local/lib/nodejs
  mkdir -p /usr/local/lib/nodejs
  mv "$extracted" /usr/local/lib/nodejs/node
  for bin in node npm npx; do
    ln -sf "/usr/local/lib/nodejs/node/bin/$bin" "/usr/local/bin/$bin"
  done
  rm -rf "$tmp"
}

ensure_node() {
  if node_is_ok && [ "$FORCE_NODE" != "1" ]; then
    ok "Node.js $(node -v) detected"
    return 0
  fi
  step "installing Node.js"
  detect_pkg || true
  if [ -n "$PKG" ]; then
    pkg_update || warn "package index update failed, continuing"
    case "$PKG" in
      apt-get)
        pkg_install ca-certificates curl gnupg xz-utils || warn "could not install prerequisites"
        if curl -fsSL "https://deb.nodesource.com/setup_$NODE_MAJOR.x" -o /tmp/nodesource_setup.sh 2>/dev/null; then
          if bash /tmp/nodesource_setup.sh >/dev/null 2>&1 && pkg_install nodejs; then
            rm -f /tmp/nodesource_setup.sh
            if node_is_ok; then ok "Node.js $(node -v) installed"; return 0; fi
          fi
        fi
        warn "NodeSource setup unavailable, using the official tarball instead"
        ;;
      dnf|yum)
        if curl -fsSL "https://rpm.nodesource.com/setup_$NODE_MAJOR.x" -o /tmp/nodesource_setup.sh 2>/dev/null; then
          if bash /tmp/nodesource_setup.sh >/dev/null 2>&1 && pkg_install nodejs; then
            rm -f /tmp/nodesource_setup.sh
            if node_is_ok; then ok "Node.js $(node -v) installed"; return 0; fi
          fi
        fi
        warn "NodeSource setup unavailable, using the official tarball instead"
        ;;
      *)
        pkg_install xz 2>/dev/null || pkg_install xz-utils 2>/dev/null || true
        ;;
    esac
  fi
  install_node_tarball
  hash -r
  node_is_ok || die "Node.js installation failed - please install Node.js >= $NODE_MIN_MAJOR.$NODE_MIN_MINOR manually"
  ok "Node.js $(node -v) installed"
}

# --------------------------------------------------------------------------- #
# 1. Node.js                                                                  #
# --------------------------------------------------------------------------- #
ensure_node
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
[ -n "$NPM_BIN" ] || die "npm not found next to node"

# --------------------------------------------------------------------------- #
# 2. Service account + directories                                            #
# --------------------------------------------------------------------------- #
step "preparing the service account and directories"
if id -u "$SERVICE_USER" >/dev/null 2>&1; then
  ok "user $SERVICE_USER already exists"
else
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null \
      || useradd --system --home-dir "$DATA_DIR" --shell /sbin/nologin "$SERVICE_USER"
  else
    adduser -S -H -h "$DATA_DIR" -s /sbin/nologin "$SERVICE_USER"
  fi
  ok "created system user $SERVICE_USER"
fi

mkdir -p "$INSTALL_DIR" "$DATA_DIR" "$CONFIG_DIR"
chmod 750 "$DATA_DIR" "$CONFIG_DIR"

# --------------------------------------------------------------------------- #
# 3. Copy the application                                                     #
# --------------------------------------------------------------------------- #
step "copying the application to $INSTALL_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude 'node_modules' --exclude '.git' --exclude 'openlist' \
    --exclude '.npm-cache' --exclude 'tmp' --exclude 'data' \
    --exclude '.env' --exclude 'web/dist' --exclude 'server/dist' \
    "$SRC_DIR/" "$INSTALL_DIR/"
else
  ( cd "$SRC_DIR" && tar -cf - \
      --exclude='./node_modules' --exclude='./.git' --exclude='./openlist' \
      --exclude='./.npm-cache' --exclude='./tmp' --exclude='./data' \
      --exclude='./.env' --exclude='./web/dist' --exclude='./server/dist' . ) | ( cd "$INSTALL_DIR" && tar -xf - )
fi
ok "application files copied"

# --------------------------------------------------------------------------- #
# 4. Dependencies + build                                                     #
# --------------------------------------------------------------------------- #
export npm_config_cache="$INSTALL_DIR/.npm-cache"
export npm_config_fund=false
export npm_config_audit=false

if [ "$SKIP_DEPS" = "1" ]; then
  warn "skipping npm install (--skip-deps)"
else
  step "installing dependencies (this can take a few minutes)"
  cd "$INSTALL_DIR"
  if [ -f package-lock.json ]; then
    "$NPM_BIN" ci --no-audit --no-fund --loglevel=error || "$NPM_BIN" install --no-audit --no-fund --loglevel=error
  else
    "$NPM_BIN" install --no-audit --no-fund --loglevel=error
  fi
  cd - >/dev/null
  ok "dependencies installed"
fi

if [ "$SKIP_BUILD" = "1" ]; then
  warn "skipping the build (--skip-build)"
else
  step "building the front-end and the server"
  cd "$INSTALL_DIR"
  # BASE_PATH has to be known at build time so that asset URLs stay correct.
  VITE_BASE_PATH="$BASE_PATH" "$NPM_BIN" run build --loglevel=error
  cd - >/dev/null
  [ -f "$INSTALL_DIR/web/dist/index.html" ] || die "front-end build missing (web/dist/index.html)"
  [ -f "$INSTALL_DIR/server/dist/index.js" ] || die "server build missing (server/dist/index.js)"
  ok "build finished"
fi

# --------------------------------------------------------------------------- #
# 5. Configuration                                                            #
# --------------------------------------------------------------------------- #
step "writing the configuration"
ENV_FILE="$CONFIG_DIR/notes-manager.env"

if [ -z "$ADMIN_PASSWORD" ]; then
  if [ -f "$ENV_FILE" ] && grep -q '^ADMIN_PASSWORD=' "$ENV_FILE"; then
    ADMIN_PASSWORD="$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2-)"
    info "keeping the existing administrator password"
  else
    ADMIN_PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 18)"
    info "generated a random administrator password"
  fi
fi

cat > "$ENV_FILE" <<ENV_EOF
# notes-manager-web configuration - generated by install.sh
# Edit this file and run: systemctl restart $SERVICE_NAME

HOST=$HOST
PORT=$PORT
BASE_PATH=$BASE_PATH
PUBLIC_URL=$PUBLIC_URL

DATA_DIR=$DATA_DIR
LOG_LEVEL=info

# Storage: auto (OpenList when reachable, otherwise local disk), openlist or local
STORAGE_DRIVER=$STORAGE_DRIVER
OPENLIST_URL=$OPENLIST_URL
OPENLIST_TOKEN=$OPENLIST_TOKEN
OPENLIST_ROOT=$OPENLIST_ROOT
OPENLIST_PER_USER=$OPENLIST_PER_USER
NOTES_ROOT=$DATA_DIR/notes

ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
AUTH_LOCAL_ENABLED=$AUTH_LOCAL_ENABLED
ENV_EOF
chmod 640 "$ENV_FILE"
ok "configuration written to $ENV_FILE"

# --------------------------------------------------------------------------- #
# 6. systemd unit                                                             #
# --------------------------------------------------------------------------- #
step "installing the systemd service"
UNIT_FILE="/etc/systemd/system/$SERVICE_NAME.service"
cat > "$UNIT_FILE" <<UNIT_EOF
[Unit]
Description=notes-manager-web - Markdown notes manager with OpenList storage
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
Environment=NODE_ENV=production
ExecStart=$NODE_BIN $INSTALL_DIR/server/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA_DIR $INSTALL_DIR
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
UNIT_EOF

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"
chmod 750 "$INSTALL_DIR"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || warn "could not enable the service"
ok "systemd unit installed"

# --------------------------------------------------------------------------- #
# 7. Start + health check                                                     #
# --------------------------------------------------------------------------- #
HEALTH_URL="http://127.0.0.1:$PORT$BASE_PATH/api/system/health"
if [ "$START_SERVICE" = "1" ]; then
  step "starting $SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 2
  if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "service is running"
  else
    warn "the service did not start - recent logs:"
    journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
    die "startup failed"
  fi

  if command -v curl >/dev/null 2>&1; then
    healthy="0"
    for _ in $(seq 1 20); do
      if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then healthy="1"; break; fi
      sleep 1
    done
    if [ "$healthy" = "1" ]; then
      ok "health check passed ($HEALTH_URL)"
    else
      warn "health check did not answer yet - inspect: journalctl -u $SERVICE_NAME -n 50"
    fi
  fi
fi

# --------------------------------------------------------------------------- #
# 8. Summary                                                                  #
# --------------------------------------------------------------------------- #
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP_ADDR" ] || IP_ADDR="<server-ip>"
SHOWN_URL="${PUBLIC_URL:-http://$IP_ADDR:$PORT$BASE_PATH}"

printf '\n%s\n' "${C_GREEN}${C_BOLD}安装完成 / Installation complete${C_RESET}"
cat <<SUMMARY_EOF

  访问地址 (URL)      : ${C_BOLD}$SHOWN_URL${C_RESET}
  本地管理员          : $ADMIN_USERNAME
  管理员密码          : $ADMIN_PASSWORD
  存储驱动            : $STORAGE_DRIVER
  OpenList 地址       : ${OPENLIST_URL:-(未配置 / not configured)}
  OpenList 笔记目录   : $OPENLIST_ROOT

  配置文件            : $ENV_FILE
  数据目录            : $DATA_DIR
  程序目录            : $INSTALL_DIR
  服务名称            : $SERVICE_NAME

  常用命令:
    systemctl status $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f
    卸载: sudo ./scripts/uninstall.sh

SUMMARY_EOF

if [ -z "$OPENLIST_URL" ]; then
  printf '%s\n\n' "${C_YELLOW}[!] 尚未配置 OpenList 地址：面板会先使用本地目录，登录后在“设置”中填写 OpenList 地址与 API 令牌即可切换。${C_RESET}"
fi

if [ "$STORAGE_DRIVER" != "local" ] && [ -z "$OPENLIST_TOKEN" ]; then
  printf '%s\n\n' "${C_DIM}提示: 在 OpenList 中创建 API 令牌并填入 $ENV_FILE 的 OPENLIST_TOKEN，本地管理员账户即可直接读写 OpenList 目录。${C_RESET}"
fi

exit 0
