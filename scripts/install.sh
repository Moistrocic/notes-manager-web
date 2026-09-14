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
DEFAULT_HOST="0.0.0.0"
DEFAULT_OPENLIST_ROOT="/notes"
DEFAULT_ADMIN_USERNAME="admin"
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
# Option variables stay empty until resolved, so that the precedence
#   command line  >  <project>/.env  >  NOTES_MANAGER_* environment  >  default
# can be applied after the arguments have been parsed (see "Configuration
# sources" below).
INSTALL_DIR="${NOTES_MANAGER_DIR:-}"
DATA_DIR="${NOTES_MANAGER_DATA:-}"
CONFIG_DIR="${NOTES_MANAGER_CONFIG:-}"
SERVICE_USER="${NOTES_MANAGER_USER:-}"
PORT="${NOTES_MANAGER_PORT:-}"
HOST=""
BASE_PATH=""
PUBLIC_URL=""
STORAGE_DRIVER=""
OPENLIST_URL=""
OPENLIST_TOKEN=""
OPENLIST_ROOT=""
OPENLIST_PER_USER=""
ADMIN_USERNAME=""
ADMIN_PASSWORD=""
AUTH_LOCAL_ENABLED=""
SKIP_BUILD="0"
SKIP_DEPS="0"
FORCE_NODE="0"
START_SERVICE="1"
CHECK_CONFIG="0"
ADMIN_PASSWORD_GENERATED="0"

usage() {
  cat <<'USAGE_EOF'
notes-manager-web installer

Usage: sudo ./scripts/install.sh [options]

Options:
  --dir PATH              Install directory                 (default /opt/notes-manager)
  --data PATH             Data directory (notes, sessions) (default /var/lib/notes-manager)
  --config PATH           Legacy config directory, migrated on first install
                          (default /etc/notes-manager)
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
  --check-config          Print the configuration that would be used and exit
                          (reads .env, needs no root). Useful before installing
  -h, --help              Show this help

Environment variables with the NOTES_MANAGER_ prefix are honoured as well, e.g.
  NOTES_MANAGER_PORT=9000 sudo -E ./scripts/install.sh
USAGE_EOF
}

need_value() {
  [ -n "$2" ] || die "option $1 requires a value"
  printf '%s' "$2"
}

# --------------------------------------------------------------------------- #
# KEY=VALUE helpers                                                           #
#                                                                             #
# The configuration file is parsed, never sourced, so a stray command in it   #
# cannot do anything. The rules mirror the application's own loader: strip    #
# surrounding quotes, otherwise drop a trailing " # comment".                 #
# --------------------------------------------------------------------------- #

# read_env_value <file> <KEY> - prints the value, non-zero when absent
read_env_value() {
  local file="$1" key="$2" line value
  [ -f "$file" ] || return 1
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1)" || return 1
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

# set_env_value <file> <KEY> <VALUE> - replaces the first assignment, drops the
# rest, and appends the key when it was not present yet
set_env_value() {
  local file="$1" key="$2" value="$3" tmp line found="0"
  tmp="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "$key="*|"$key "*)
        if [ "$found" = "0" ]; then
          printf '%s=%s\n' "$key" "$value" >> "$tmp"
          found="1"
        fi
        ;;
      *) printf '%s\n' "$line" >> "$tmp" ;;
    esac
  done < "$file"
  if [ "$found" = "0" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$tmp"
  fi
  mv "$tmp" "$file"
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
    --check-config) CHECK_CONFIG="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

# --------------------------------------------------------------------------- #
# Preconditions                                                               #
# --------------------------------------------------------------------------- #
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$SRC_DIR/package.json" ] || die "package.json not found in $SRC_DIR - run this script from the project"
[ -f "$SRC_DIR/server/package.json" ] || die "server/ not found in $SRC_DIR"

# --------------------------------------------------------------------------- #
# Configuration sources                                                       #
# --------------------------------------------------------------------------- #
# 1. command line options (highest priority)
# 2. <project>/.env          <- copy .env.example to .env and edit it
# 3. NOTES_MANAGER_* environment variables
# 4. built-in defaults
SOURCE_ENV="$SRC_DIR/.env"

# env_from <KEY> <fallback> - value from the project .env, else the fallback
env_from() {
  local value=""
  value="$(read_env_value "$SOURCE_ENV" "$1" 2>/dev/null || true)"
  printf '%s' "${value:-$2}"
}

# everything below is already set when it came from the command line
INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
CONFIG_DIR="${CONFIG_DIR:-$DEFAULT_CONFIG_DIR}"
SERVICE_USER="${SERVICE_USER:-$APP_NAME}"
DATA_DIR="${DATA_DIR:-$(env_from DATA_DIR "$DEFAULT_DATA_DIR")}"
PORT="${PORT:-$(env_from PORT "$DEFAULT_PORT")}"
HOST="${HOST:-$(env_from HOST "$DEFAULT_HOST")}"
BASE_PATH="${BASE_PATH:-$(env_from BASE_PATH "")}"
PUBLIC_URL="${PUBLIC_URL:-$(env_from PUBLIC_URL "")}"
STORAGE_DRIVER="${STORAGE_DRIVER:-$(env_from STORAGE_DRIVER "auto")}"
OPENLIST_URL="${OPENLIST_URL:-$(env_from OPENLIST_URL "")}"
OPENLIST_TOKEN="${OPENLIST_TOKEN:-$(env_from OPENLIST_TOKEN "")}"
OPENLIST_ROOT="${OPENLIST_ROOT:-$(env_from OPENLIST_ROOT "$DEFAULT_OPENLIST_ROOT")}"
OPENLIST_PER_USER="${OPENLIST_PER_USER:-$(env_from OPENLIST_PER_USER "false")}"
ADMIN_USERNAME="${ADMIN_USERNAME:-$(env_from ADMIN_USERNAME "$DEFAULT_ADMIN_USERNAME")}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(env_from ADMIN_PASSWORD "")}"
AUTH_LOCAL_ENABLED="${AUTH_LOCAL_ENABLED:-$(env_from AUTH_LOCAL_ENABLED "true")}"

# A systemd service needs absolute paths; .env.example ships "./data".
configured_data_dir="$DATA_DIR"
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="$DEFAULT_DATA_DIR" ;;
esac

RUNTIME_ENV="$INSTALL_DIR/.env"

# NOTES_ROOT is written as-is when absolute, otherwise derived from DATA_DIR.
NOTES_ROOT_PREVIEW="$DATA_DIR/notes"
configured_notes_root_preview="$(read_env_value "$SOURCE_ENV" NOTES_ROOT 2>/dev/null || true)"
case "$configured_notes_root_preview" in
  /*) NOTES_ROOT_PREVIEW="$configured_notes_root_preview" ;;
esac

# Validation runs *after* the values above have been resolved. Doing it earlier
# is a real trap: a plain "./scripts/install.sh" would then compare an empty
# STORAGE_DRIVER against the allow-list and abort.
case "$STORAGE_DRIVER" in
  auto|openlist|local) ;;
  *) die "storage driver must be one of: auto, openlist, local (got '$STORAGE_DRIVER')" ;;
esac

case "$AUTH_LOCAL_ENABLED" in
  true|false) ;;
  *) die "AUTH_LOCAL_ENABLED must be true or false (got '$AUTH_LOCAL_ENABLED')" ;;
esac

case "$OPENLIST_PER_USER" in
  true|false) ;;
  *) die "OPENLIST_PER_USER must be true or false (got '$OPENLIST_PER_USER')" ;;
esac

case "$PORT" in
  ''|*[!0-9]*) die "PORT must be a number (got '$PORT')" ;;
esac

# show_resolved_config - what "install.sh --check-config" prints
show_resolved_config() {
  printf '\n%s\n\n' "${C_BOLD}resolved configuration${C_RESET}"
  printf '  %-16s %s\n' 'source .env' "${SOURCE_ENV}$([ -f "$SOURCE_ENV" ] && echo ' (found)' || echo ' (not found - defaults are used)')"
  printf '  %-16s %s\n' 'runtime .env' "$RUNTIME_ENV"
  printf '  %-16s %s\n' 'install dir' "$INSTALL_DIR"
  printf '  %-16s %s\n' 'data dir' "$DATA_DIR"
  printf '  %-16s %s\n' 'notes root' "$NOTES_ROOT_PREVIEW"
  printf '  %-16s %s\n' 'service user' "$SERVICE_USER"
  printf '  %-16s %s\n' 'listen' "${HOST}:${PORT}${BASE_PATH}"
  printf '  %-16s %s\n' 'public url' "${PUBLIC_URL:-(none)}"
  printf '  %-16s %s\n' 'storage driver' "$STORAGE_DRIVER"
  printf '  %-16s %s\n' 'openlist url' "${OPENLIST_URL:-(not configured)}"
  printf '  %-16s %s\n' 'openlist root' "$OPENLIST_ROOT"
  printf '  %-16s %s\n' 'openlist token' "$([ -n "$OPENLIST_TOKEN" ] && echo '(set)' || echo '(not set)')"
  printf '  %-16s %s\n' 'per user' "$OPENLIST_PER_USER"
  printf '  %-16s %s\n' 'admin user' "$ADMIN_USERNAME"
  printf '  %-16s %s\n' 'local auth' "$AUTH_LOCAL_ENABLED"
  printf '  %-16s %s\n' 'admin password' "$([ -n "$ADMIN_PASSWORD" ] && echo '(set)' || echo '(will be generated)')"
  printf '\n'
}

# Sources that must exist before the build. They are checked twice - once on the
# checkout and once again after copying - because a bad file filter can silently
# drop a directory, and the only symptom would be a wall of TypeScript errors
# much later in the run.
CRITICAL_SOURCES="
server/src/index.ts
server/src/integrations/openlist/client.ts
server/src/storage/manager.ts
server/src/notes/repository.ts
web/src/main.tsx
web/src/App.tsx
web/package.json
"

# verify_tree <directory> <label>
verify_tree() {
  local dir="$1" label="$2" required missing=""
  for required in $CRITICAL_SOURCES; do
    if [ ! -f "$dir/$required" ]; then
      missing="$missing
    - $required"
    fi
  done
  if [ -n "$missing" ]; then
    printf '%b\n' "«C_RED»[error]«C_RESET» $label is incomplete:$missing" >&2
    return 1
  fi
  return 0
}

verify_tree "$SRC_DIR" "the source tree in $SRC_DIR" \
  || die "run 'git pull' in $SRC_DIR to update the checkout, then try again"

# Everything above runs as a normal user: --check-config resolves the whole
# configuration (project .env, environment, defaults) without touching the
# system, which also makes the resolution testable.
if [ "$CHECK_CONFIG" = "1" ]; then
  show_resolved_config
  exit 0
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
# The copy uses `find -prune` + tar rather than rsync on purpose. rsync matches
# an exclude pattern without a "/" against the *final path component* at any
# depth, so "--exclude openlist" also swallowed server/src/integrations/openlist/
# and the build failed with TS2307. `find -path` matches exact paths instead.
copy_application() {
  local src="$1" dst="$2" entry

  case "$dst" in
    /|/usr|/usr/*|/etc|/etc/*|/bin|/sbin|/lib|/lib/*|/boot|/var)
      die "refusing to use $dst as the install directory" ;;
  esac

  # Full resync: drop the previous application files but keep the dependency
  # tree and the npm cache so that re-installing stays fast.
  for entry in "$dst"/* "$dst"/.[!.]*; do
    [ -e "$entry" ] || continue
    case "${entry##*/}" in
      # keep the dependency tree, the npm cache and any local configuration
      node_modules|.npm-cache|.env|.env.local) continue ;;
    esac
    rm -rf "$entry"
  done

  (
    cd "$src" || exit 1
    find . -mindepth 1 \
      \( -name node_modules -o -name .npm-cache -o -name .git \) -prune -o \
      -path './openlist' -prune -o \
      -path './tmp' -prune -o \
      -path './data' -prune -o \
      -path './.env' -prune -o \
      -path './.npmrc' -prune -o \
      -path './web/dist' -prune -o \
      -path './server/dist' -prune -o \
      -type f -print
  ) | tar -cf - -T - | ( cd "$dst" && tar -xf - )

  # tar preserves modes, but keep the helper scripts executable even on tar
  # builds or filesystems that drop the bit.
  chmod +x "$dst"/scripts/*.sh 2>/dev/null || true
}

step "copying the application to $INSTALL_DIR"
copy_application "$SRC_DIR" "$INSTALL_DIR"
verify_tree "$INSTALL_DIR" "the copied tree in $INSTALL_DIR" \
  || die "the file copy dropped source files - please report this together with the installer output"
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
step "writing the runtime configuration"

# The runtime file is seeded from whatever the user maintains:
#   1. <project>/.env            (what "cp .env.example .env" produces)
#   2. /etc/notes-manager/notes-manager.env  (layout of releases before 1.0.1)
#   3. .env.example              (first install without a .env)
LEGACY_ENV="$CONFIG_DIR/notes-manager.env"
BASE_ENV=""
if [ -f "$SOURCE_ENV" ]; then
  BASE_ENV="$SOURCE_ENV"
  info "configuration source: $SOURCE_ENV"
elif [ -f "$LEGACY_ENV" ]; then
  BASE_ENV="$LEGACY_ENV"
  warn "no $SOURCE_ENV - migrating the previous configuration from $LEGACY_ENV"
elif [ -f "$SRC_DIR/.env.example" ]; then
  BASE_ENV="$SRC_DIR/.env.example"
  info "no $SOURCE_ENV - starting from .env.example"
fi

# Read the password of an existing installation *before* the file is replaced,
# otherwise every re-install would rotate it.
existing_password="$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD 2>/dev/null || true)"

if [ -n "$BASE_ENV" ]; then
  cp "$BASE_ENV" "$RUNTIME_ENV"
else
  : > "$RUNTIME_ENV"
fi

# Keep the installed password unless the project .env or the command line
# provided a new one.
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$existing_password"
fi
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 18)"
  ADMIN_PASSWORD_GENERATED="1"
fi

notes_root="$DATA_DIR/notes"
configured_notes_root="$(read_env_value "$RUNTIME_ENV" NOTES_ROOT 2>/dev/null || true)"
case "$configured_notes_root" in
  /*) notes_root="$configured_notes_root" ;;
esac

log_level="$(read_env_value "$RUNTIME_ENV" LOG_LEVEL 2>/dev/null || true)"
log_level="${log_level:-info}"

set_env_value "$RUNTIME_ENV" HOST "$HOST"
set_env_value "$RUNTIME_ENV" PORT "$PORT"
set_env_value "$RUNTIME_ENV" BASE_PATH "$BASE_PATH"
set_env_value "$RUNTIME_ENV" PUBLIC_URL "$PUBLIC_URL"
set_env_value "$RUNTIME_ENV" DATA_DIR "$DATA_DIR"
set_env_value "$RUNTIME_ENV" LOG_LEVEL "$log_level"
set_env_value "$RUNTIME_ENV" STORAGE_DRIVER "$STORAGE_DRIVER"
set_env_value "$RUNTIME_ENV" OPENLIST_URL "$OPENLIST_URL"
set_env_value "$RUNTIME_ENV" OPENLIST_TOKEN "$OPENLIST_TOKEN"
set_env_value "$RUNTIME_ENV" OPENLIST_ROOT "$OPENLIST_ROOT"
set_env_value "$RUNTIME_ENV" OPENLIST_PER_USER "$OPENLIST_PER_USER"
set_env_value "$RUNTIME_ENV" NOTES_ROOT "$notes_root"
set_env_value "$RUNTIME_ENV" ADMIN_USERNAME "$ADMIN_USERNAME"
set_env_value "$RUNTIME_ENV" ADMIN_PASSWORD "$ADMIN_PASSWORD"
set_env_value "$RUNTIME_ENV" AUTH_LOCAL_ENABLED "$AUTH_LOCAL_ENABLED"

chown "$SERVICE_USER:$SERVICE_USER" "$RUNTIME_ENV"
chmod 600 "$RUNTIME_ENV"

if [ "$configured_data_dir" != "$DATA_DIR" ]; then
  info "DATA_DIR '$configured_data_dir' is relative - the service uses $DATA_DIR"
fi
if [ "$ADMIN_PASSWORD_GENERATED" = "1" ]; then
  info "generated a random administrator password (stored in the file below)"
else
  info "keeping the administrator password from the configuration"
fi
ok "runtime configuration: $RUNTIME_ENV"

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
# ENV_FILE tells the application which configuration file is authoritative.
# There is deliberately no EnvironmentFile= here: a second source of variables
# would silently shadow .env and make edits look like they had no effect.
Environment=ENV_FILE=$RUNTIME_ENV
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

  运行时配置文件      : $RUNTIME_ENV   <-- 所有配置都在这里修改
  数据目录            : $DATA_DIR
  程序目录            : $INSTALL_DIR
  服务名称            : $SERVICE_NAME

  修改配置:
    sudo nano $RUNTIME_ENV
    sudo systemctl restart $SERVICE_NAME

  常用命令:
    systemctl status $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    journalctl -u $SERVICE_NAME -f
    卸载: sudo ./scripts/uninstall.sh

SUMMARY_EOF

if [ -z "$OPENLIST_URL" ]; then
  printf '%s\n\n' "${C_YELLOW}[!] 尚未配置 OpenList 地址：面板会先使用本地目录，登录后在「设置」中填写 OpenList 地址与 API 令牌即可切换。${C_RESET}"
fi

if [ "$STORAGE_DRIVER" != "local" ] && [ -z "$OPENLIST_TOKEN" ]; then
  printf '%s\n\n' "${C_DIM}提示: 在 OpenList 中创建 API 令牌并填入 $RUNTIME_ENV 的 OPENLIST_TOKEN，本地管理员账户即可直接读写 OpenList 目录。${C_RESET}"
fi

exit 0
