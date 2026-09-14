#!/usr/bin/env bash
# =============================================================================
#  Tests for the installer (scripts/install.sh).
# =============================================================================
#  The functions under test are extracted straight out of install.sh, so these
#  tests exercise the shipped implementation rather than a copy of it.
#
#    bash scripts/test-install.sh
# =============================================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/install.sh"
[ -f "$INSTALLER" ] || { echo "install.sh not found next to this script" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

FAILED=0
check() {
  if [ "$2" = "$3" ]; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s (got %s, want %s)\n' "$1" "$2" "$3"
    FAILED=1
  fi
}
exists() { [ -e "$1" ] && echo yes || echo no; }

# --- stubs for the parts of install.sh we do not want to run --------------- #
# C_RED/C_RESET are read by the verify_tree() body that is extracted from
# install.sh and evaluated below; shellcheck cannot see those references.
# shellcheck disable=SC2034
C_RED=""
# shellcheck disable=SC2034
C_RESET=""
die() { printf '[test] die: %s\n' "$*" >&2; return 1; }

# extract_function <name> - prints the body of a top level shell function
extract_function() {
  awk -v fn="$1" '
    $0 ~ "^" fn "\\(\\) \\{" { inside = 1 }
    inside { print }
    inside && /^}$/ { exit }
  ' "$INSTALLER"
}

for fn in verify_tree copy_application read_env_value set_env_value; do
  body="$(extract_function "$fn")"
  [ -n "$body" ] || { echo "could not extract $fn() from install.sh" >&2; exit 1; }
  eval "$body"
done

# the list of sources verify_tree() insists on
critical="$(sed -n '/^CRITICAL_SOURCES="/,/^"$/p' "$INSTALLER")"
[ -n "$critical" ] || { echo "could not extract CRITICAL_SOURCES from install.sh" >&2; exit 1; }
eval "$critical"

# =========================================================================== #
# 1. KEY=VALUE parsing                                                        #
# =========================================================================== #
echo "configuration file parsing"

ENVFILE="$WORK/config.env"
cat > "$ENVFILE" <<'ENV_FIXTURE'
# leading comment
PORT=8080
HOST="192.168.1.10"
TOKEN='se#cret'
WITH_COMMENT=value # trailing note
EMPTY=
  INDENTED=1
# COMMENTED=9
ENV_FIXTURE

check "plain value"              "$(read_env_value "$ENVFILE" PORT)" "8080"
check "double quoted value"      "$(read_env_value "$ENVFILE" HOST)" "192.168.1.10"
check "single quotes keep #"     "$(read_env_value "$ENVFILE" TOKEN)" "se#cret"
check "trailing comment stripped" "$(read_env_value "$ENVFILE" WITH_COMMENT)" "value"
check "empty value"              "$(read_env_value "$ENVFILE" EMPTY)" ""
check "indented key"             "$(read_env_value "$ENVFILE" INDENTED)" "1"
check "commented key is ignored" "$(read_env_value "$ENVFILE" COMMENTED 2>/dev/null || echo ABSENT)" "ABSENT"
check "missing key is ignored"   "$(read_env_value "$ENVFILE" NOPE 2>/dev/null || echo ABSENT)" "ABSENT"
check "missing file is ignored"  "$(read_env_value "$WORK/nope.env" PORT 2>/dev/null || echo ABSENT)" "ABSENT"

set_env_value "$ENVFILE" PORT 9000
check "existing key replaced"    "$(read_env_value "$ENVFILE" PORT)" "9000"
check "no duplicate left behind" "$(grep -c '^PORT=' "$ENVFILE")" "1"
set_env_value "$ENVFILE" NEWKEY "hello world"
check "new key appended"         "$(read_env_value "$ENVFILE" NEWKEY)" "hello world"
check "surrounding comments kept" "$(grep -c '^# leading comment$' "$ENVFILE")" "1"
set_env_value "$ENVFILE" DUP first
set_env_value "$ENVFILE" DUP second
check "repeated writes stay single" "$(grep -c '^DUP=' "$ENVFILE")" "1"
check "repeated writes win"      "$(read_env_value "$ENVFILE" DUP)" "second"

# =========================================================================== #
# 2. application copy                                                         #
# =========================================================================== #
echo ""
echo "application copy"

SRC="$WORK/src"
DST="$WORK/dst"
mkdir -p "$DST"

mkdir -p "$SRC/openlist" "$SRC/.git" "$SRC/node_modules/dep" "$SRC/.npm-cache" \
         "$SRC/tmp" "$SRC/data" \
         "$SRC/server/src/integrations/openlist" "$SRC/server/src/storage" \
         "$SRC/web/src" "$SRC/web/dist" "$SRC/server/dist" "$SRC/scripts"

echo ref   > "$SRC/openlist/README.md"                 # reference clone (root only)
echo git   > "$SRC/.git/config"
echo dep   > "$SRC/node_modules/dep/index.js"
echo cache > "$SRC/.npm-cache/blob"
echo tmp   > "$SRC/tmp/scratch"
echo data  > "$SRC/data/state.json"
echo pkg   > "$SRC/package.json"
echo npmrc > "$SRC/.npmrc"                              # local-only npm config
echo lock  > "$SRC/package-lock.json"
echo build > "$SRC/web/dist/index.html"
echo build > "$SRC/server/dist/index.js"
echo sh    > "$SRC/scripts/install.sh"
chmod 755 "$SRC/scripts/install.sh"

# every entry of CRITICAL_SOURCES
echo idx  > "$SRC/server/src/index.ts"
echo cli  > "$SRC/server/src/integrations/openlist/client.ts"   # <-- the regression
echo mgr  > "$SRC/server/src/storage/manager.ts"                 #     case
mkdir -p "$SRC/server/src/notes"
echo repo > "$SRC/server/src/notes/repository.ts"
echo main > "$SRC/web/src/main.tsx"
echo app  > "$SRC/web/src/App.tsx"
echo wpkg > "$SRC/web/package.json"
echo spkg > "$SRC/server/package.json"

# a stale file from a previous release must be wiped by the resync
echo stale > "$DST/obsolete-module.js"
mkdir -p "$DST/node_modules/keepme"
echo keep > "$DST/node_modules/keepme/index.js"
# while local configuration and the dependency tree must survive it
echo 'PORT=9000' > "$DST/.env"

copy_application "$SRC" "$DST"
verify_tree "$DST" "copied tree"

check "nested server/src/integrations/openlist/client.ts copied" "$(exists "$DST/server/src/integrations/openlist/client.ts")" "yes"
check "root reference clone openlist/ excluded"                  "$(exists "$DST/openlist")" "no"
check "node_modules excluded from the copy source"               "$(exists "$DST/.git")" "no"
check ".npm-cache excluded"                                      "$(exists "$DST/.npm-cache")" "no"
check "tmp excluded"                                             "$(exists "$DST/tmp")" "no"
check "data excluded"                                            "$(exists "$DST/data")" "no"
check "local .npmrc excluded"                                    "$(exists "$DST/.npmrc")" "no"
check "web/dist excluded"                                        "$(exists "$DST/web/dist")" "no"
check "server/dist excluded"                                     "$(exists "$DST/server/dist")" "no"
check "package.json copied"                                      "$(exists "$DST/package.json")" "yes"
check "scripts/install.sh copied"                                "$(exists "$DST/scripts/install.sh")" "yes"
check "helper scripts stay executable"                           "$([ -x "$DST/scripts/install.sh" ] && echo yes || echo no)" "yes"
check "stale file from a previous release removed"               "$(exists "$DST/obsolete-module.js")" "no"
check "existing node_modules preserved"                          "$(exists "$DST/node_modules/keepme/index.js")" "yes"
check "existing .env preserved across a reinstall"               "$(exists "$DST/.env")" "yes"

# verify_tree must also fail loudly on an incomplete tree
rm -f "$DST/server/src/integrations/openlist/client.ts"
if verify_tree "$DST" "broken tree" >/dev/null 2>&1; then
  printf '  FAIL  verify_tree accepts a tree with missing sources\n'
  FAILED=1
else
  printf '  ok    verify_tree rejects a tree with missing sources\n'
fi

# =========================================================================== #
# 3. runtime configuration assembly                                           #
# =========================================================================== #
echo ""
echo "runtime configuration"

CFG_SRC="$WORK/project"
CFG_INSTALL="$WORK/opt"
mkdir -p "$CFG_SRC" "$CFG_INSTALL"
cat > "$CFG_SRC/.env" <<'ENV_FIXTURE'
# user configuration, exactly as "cp .env.example .env" would leave it
PORT=9777
HOST=127.0.0.1
STORAGE_DRIVER=openlist
OPENLIST_URL=http://127.0.0.1:5244
OPENLIST_ROOT=/my-notes
OPENLIST_PER_USER=false
ADMIN_USERNAME=boss
ADMIN_PASSWORD=secret-from-dotenv
AUTH_LOCAL_ENABLED=true
DATA_DIR=./data
NOTES_ROOT=./data/notes
LOG_LEVEL=debug
ENV_FIXTURE

# These are the variables the configuration section of install.sh expects. They
# are exported so that shellcheck does not report them as unused - the section
# that reads them is extracted and evaluated at runtime, which shellcheck
# cannot follow.
export SRC_DIR="$CFG_SRC"
export SOURCE_ENV="$SRC_DIR/.env"
export INSTALL_DIR="$CFG_INSTALL"
export RUNTIME_ENV="$INSTALL_DIR/.env"
export CONFIG_DIR="$WORK/etc"
export SERVICE_NAME="notes-manager"
export SERVICE_USER
SERVICE_USER="$(id -un)"
export DATA_DIR="$WORK/var-lib"
export DEFAULT_DATA_DIR="$WORK/var-lib"
export ADMIN_PASSWORD_GENERATED="0"
export configured_data_dir="./data"
export HOST="127.0.0.1"
export PORT="9777"
export BASE_PATH=""
export PUBLIC_URL=""
export STORAGE_DRIVER="openlist"
export OPENLIST_URL="http://127.0.0.1:5244"
export OPENLIST_TOKEN=""
export OPENLIST_ROOT="/my-notes"
export OPENLIST_PER_USER="false"
export ADMIN_USERNAME="boss"
export ADMIN_PASSWORD="secret-from-dotenv"
export AUTH_LOCAL_ENABLED="true"

# the section under test only prints and chowns; stub both out
step() { :; }
info() { :; }
ok() { :; }
warn() { :; }
chown() { :; }

cfg_block="$(awk '/^# 5\. Configuration/,/^# 6\. systemd unit/' "$INSTALLER" | head -n -2)"
[ -n "$cfg_block" ] || { echo "could not extract the configuration section" >&2; exit 1; }
eval "$cfg_block"

check "runtime .env created next to the app" "$(exists "$RUNTIME_ENV")" "yes"
check "PORT carried over from project .env"  "$(read_env_value "$RUNTIME_ENV" PORT)" "9777"
check "HOST carried over"                    "$(read_env_value "$RUNTIME_ENV" HOST)" "127.0.0.1"
check "STORAGE_DRIVER carried over"          "$(read_env_value "$RUNTIME_ENV" STORAGE_DRIVER)" "openlist"
check "OPENLIST_URL carried over"            "$(read_env_value "$RUNTIME_ENV" OPENLIST_URL)" "http://127.0.0.1:5244"
check "OPENLIST_ROOT carried over"           "$(read_env_value "$RUNTIME_ENV" OPENLIST_ROOT)" "/my-notes"
check "ADMIN_USERNAME carried over"          "$(read_env_value "$RUNTIME_ENV" ADMIN_USERNAME)" "boss"
check "ADMIN_PASSWORD kept as configured"    "$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)" "secret-from-dotenv"
check "LOG_LEVEL preserved"                  "$(read_env_value "$RUNTIME_ENV" LOG_LEVEL)" "debug"
check "relative DATA_DIR made absolute"      "$(read_env_value "$RUNTIME_ENV" DATA_DIR)" "$DATA_DIR"
check "relative NOTES_ROOT follows DATA_DIR" "$(read_env_value "$RUNTIME_ENV" NOTES_ROOT)" "$DATA_DIR/notes"
check "comments from the source .env survive" "$(grep -c '^# user configuration' "$RUNTIME_ENV" || true)" "1"

# an absolute NOTES_ROOT must be respected
set_env_value "$SOURCE_ENV" NOTES_ROOT /srv/notes
: > "$RUNTIME_ENV"
eval "$cfg_block"
check "absolute NOTES_ROOT respected"        "$(read_env_value "$RUNTIME_ENV" NOTES_ROOT)" "/srv/notes"

# A re-install must not rotate the administrator password: the project .env no
# longer carries one (it was consumed on the first install), so the password
# already present in the runtime file has to win.
set_env_value "$SOURCE_ENV" ADMIN_PASSWORD ""
ADMIN_PASSWORD=""
export ADMIN_PASSWORD
eval "$cfg_block"
check "existing password survives reinstall" "$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)" "secret-from-dotenv"

# ...and a password given on the command line still overrides it
export ADMIN_PASSWORD="from-command-line"
eval "$cfg_block"
check "command line password overrides"      "$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)" "from-command-line"
ADMIN_PASSWORD=""
export ADMIN_PASSWORD

# an empty runtime file (fresh install) gets a generated password
rm -f "$RUNTIME_ENV"
set_env_value "$SOURCE_ENV" ADMIN_PASSWORD ""
ADMIN_PASSWORD=""
export ADMIN_PASSWORD
eval "$cfg_block"
generated="$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)"
check "fresh install generates a password"   "$([ -n "$generated" ] && echo yes || echo no)" "yes"
check "generated password has 18 chars"      "${#generated}" "18"

if [ "$FAILED" -eq 0 ]; then
  printf '\nInstaller tests passed\n'
else
  printf '\nInstaller tests FAILED\n'
  exit 1
fi