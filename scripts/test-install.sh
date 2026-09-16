#!/usr/bin/env bash
# =============================================================================
#  Tests for the installer (scripts/install.sh).
# =============================================================================
#  Three of the four suites extract the real functions / configuration section
#  out of install.sh, and the last one executes install.sh itself, so ordering
#  mistakes at the top level are covered too.
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
    printf '  FAIL  %s (got [%s], want [%s])\n' "$1" "$2" "$3"
    FAILED=1
  fi
}
exists() { [ -e "$1" ] && echo yes || echo no; }

# --- stubs for the parts of install.sh we do not want to run --------------- #
C_RED=""
C_RESET=""
# read by the verify_tree() body that is extracted from install.sh and evaluated
# below, which shellcheck cannot follow
: "$C_RED" "$C_RESET"
die() { printf '[test] die: %s\n' "$*" >&2; return 1; }

# read by the dependency freshness functions extracted from install.sh and
# evaluated below, which shellcheck cannot follow
DEPS_STAMP="node_modules/.notes-manager-lock"
: "$DEPS_STAMP"

# extract_function <name> - prints the body of a top level shell function.
# The contract: a function ends at the first "}" in column 0, so embedded
# scripts (the node -e block in find_missing_dependencies) must be indented.
extract_function() {
  awk -v fn="$1" '
    $0 ~ "^" fn "\\(\\) \\{" { inside = 1 }
    inside { print }
    inside && /^}$/ { exit }
  ' "$INSTALLER"
}

for fn in verify_tree copy_application read_env_value set_env_value \
  fingerprint_lock write_deps_stamp dependencies_are_current find_missing_dependencies \
  read_project_version; do
  body="$(extract_function "$fn")"
  [ -n "$body" ] || { echo "could not extract $fn() from install.sh" >&2; exit 1; }
  eval "$body"
done

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

check "plain value"                "$(read_env_value "$ENVFILE" PORT)" "8080"
check "double quoted value"        "$(read_env_value "$ENVFILE" HOST)" "192.168.1.10"
check "single quotes keep #"       "$(read_env_value "$ENVFILE" TOKEN)" "se#cret"
check "trailing comment stripped"  "$(read_env_value "$ENVFILE" WITH_COMMENT)" "value"
check "empty value"                "$(read_env_value "$ENVFILE" EMPTY)" ""
check "indented key"               "$(read_env_value "$ENVFILE" INDENTED)" "1"
check "commented key is ignored"   "$(read_env_value "$ENVFILE" COMMENTED 2>/dev/null || echo ABSENT)" "ABSENT"
check "missing key is ignored"     "$(read_env_value "$ENVFILE" NOPE 2>/dev/null || echo ABSENT)" "ABSENT"
check "missing file is ignored"    "$(read_env_value "$WORK/nope.env" PORT 2>/dev/null || echo ABSENT)" "ABSENT"

set_env_value "$ENVFILE" PORT 9000
check "existing key replaced"      "$(read_env_value "$ENVFILE" PORT)" "9000"
check "no duplicate left behind"   "$(grep -c '^PORT=' "$ENVFILE")" "1"
set_env_value "$ENVFILE" NEWKEY "hello world"
check "new key appended"           "$(read_env_value "$ENVFILE" NEWKEY)" "hello world"
check "surrounding comments kept"  "$(grep -c '^# leading comment$' "$ENVFILE")" "1"
set_env_value "$ENVFILE" DUP first
set_env_value "$ENVFILE" DUP second
check "repeated writes stay single" "$(grep -c '^DUP=' "$ENVFILE")" "1"
check "repeated writes win"        "$(read_env_value "$ENVFILE" DUP)" "second"

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

echo idx  > "$SRC/server/src/index.ts"
echo cli  > "$SRC/server/src/integrations/openlist/client.ts"   # <-- the regression
echo mgr  > "$SRC/server/src/storage/manager.ts"                 #     case
mkdir -p "$SRC/server/src/notes"
echo repo > "$SRC/server/src/notes/repository.ts"
echo main > "$SRC/web/src/main.tsx"
echo app  > "$SRC/web/src/App.tsx"
echo wpkg > "$SRC/web/package.json"
echo spkg > "$SRC/server/package.json"

# The scene library submodule: a directory with its own .git file, which the
# copy must walk into for the source but leave the git metadata behind. Its
# dist/ is a build product, not something the repository carries.
mkdir -p "$SRC/web/src/lib/wallpaper-scene-layers/packages/we-scene/src" \
         "$SRC/web/src/lib/wallpaper-scene-layers/packages/we-scene/dist"
echo gitfile > "$SRC/web/src/lib/wallpaper-scene-layers/.git"
echo repo    > "$SRC/web/src/lib/wallpaper-scene-layers/package.json"
echo entry   > "$SRC/web/src/lib/wallpaper-scene-layers/packages/we-scene/src/index.ts"
echo built   > "$SRC/web/src/lib/wallpaper-scene-layers/packages/we-scene/dist/index.js"

# Whatever the installer insists on, so a new entry in CRITICAL_SOURCES does
# not need a matching line here as well. It grew twice today and this fixture
# went red both times, which is a test failing for being out of date rather than
# for finding anything.
for required in $CRITICAL_SOURCES; do
  mkdir -p "$SRC/$(dirname "$required")"
  [ -e "$SRC/$required" ] || echo fixture > "$SRC/$required"
done

echo stale > "$DST/obsolete-module.js"
mkdir -p "$DST/node_modules/keepme"
echo keep > "$DST/node_modules/keepme/index.js"
echo 'PORT=9000' > "$DST/.env"

copy_application "$SRC" "$DST"
verify_tree "$DST" "copied tree"

check "nested server/src/integrations/openlist/client.ts copied" "$(exists "$DST/server/src/integrations/openlist/client.ts")" "yes"
check "submodule sources copied"                                 "$(exists "$DST/web/src/lib/wallpaper-scene-layers/packages/we-scene/src/index.ts")" "yes"
check "submodule working tree metadata left behind"              "$(exists "$DST/web/src/lib/wallpaper-scene-layers/.git")" "no"
check "root reference clone openlist/ excluded"                  "$(exists "$DST/openlist")" "no"
check ".git excluded"                                            "$(exists "$DST/.git")" "no"
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

CFG_SRC="$WORK/cfg-src"
CFG_INSTALL="$WORK/cfg-install"
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

SRC_DIR="$CFG_SRC"
SOURCE_ENV="$SRC_DIR/.env"
INSTALL_DIR="$CFG_INSTALL"
RUNTIME_ENV="$INSTALL_DIR/.env"
CONFIG_DIR="$WORK/etc"
SERVICE_NAME="notes-manager"
SERVICE_USER="$(id -un)"
DATA_DIR="$WORK/var-lib"
DEFAULT_DATA_DIR="$WORK/var-lib"
ADMIN_PASSWORD_GENERATED="0"
configured_data_dir="./data"
HOST="127.0.0.1"
PORT="9777"
BASE_PATH=""
PUBLIC_URL=""
STORAGE_DRIVER="openlist"
OPENLIST_URL="http://127.0.0.1:5244"
OPENLIST_TOKEN=""
OPENLIST_ROOT="/my-notes"
OPENLIST_PER_USER="false"
ADMIN_USERNAME="boss"
ADMIN_PASSWORD="secret-from-dotenv"
AUTH_LOCAL_ENABLED="true"

# The configuration section that is extracted from install.sh and evaluated
# below reads all of the variables above, which shellcheck cannot follow.
# Referencing them here marks them as used (and is otherwise a no-op).
: "$SRC_DIR" "$SOURCE_ENV" "$INSTALL_DIR" "$RUNTIME_ENV" "$CONFIG_DIR" "$SERVICE_NAME" \
  "$SERVICE_USER" "$DATA_DIR" "$DEFAULT_DATA_DIR" "$ADMIN_PASSWORD_GENERATED" "$configured_data_dir" \
  "$HOST" "$PORT" "$BASE_PATH" "$PUBLIC_URL" "$STORAGE_DRIVER" "$OPENLIST_URL" "$OPENLIST_TOKEN" \
  "$OPENLIST_ROOT" "$OPENLIST_PER_USER" "$ADMIN_USERNAME" "$ADMIN_PASSWORD" "$AUTH_LOCAL_ENABLED"

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
check "comments from the source .env survive" "$(grep -c '^# user configuration' "$RUNTIME_ENV")" "1"

set_env_value "$SOURCE_ENV" NOTES_ROOT /srv/notes
: > "$RUNTIME_ENV"
eval "$cfg_block"
check "absolute NOTES_ROOT respected"        "$(read_env_value "$RUNTIME_ENV" NOTES_ROOT)" "/srv/notes"

# A reinstall must not rotate the administrator password: the project .env no
# longer carries one, so the value already in the runtime file has to win.
set_env_value "$SOURCE_ENV" ADMIN_PASSWORD ""
ADMIN_PASSWORD=""
eval "$cfg_block"
check "existing password survives reinstall" "$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)" "secret-from-dotenv"

ADMIN_PASSWORD="from-command-line"
eval "$cfg_block"
check "command line password overrides"      "$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)" "from-command-line"
ADMIN_PASSWORD=""

rm -f "$RUNTIME_ENV"
set_env_value "$SOURCE_ENV" ADMIN_PASSWORD ""
ADMIN_PASSWORD=""
eval "$cfg_block"
generated="$(read_env_value "$RUNTIME_ENV" ADMIN_PASSWORD)"
check "fresh install generates a password"   "$([ -n "$generated" ] && echo yes || echo no)" "yes"
check "generated password has 18 chars"      "${#generated}" "18"

# =========================================================================== #
# 4. resolved configuration - runs the real install.sh --check-config         #
# =========================================================================== #
echo ""
echo "resolved configuration (install.sh --check-config)"

PROJ="$WORK/ckproj"
mkdir -p "$PROJ/scripts" "$PROJ/server" "$PROJ/web"
cp "$INSTALLER" "$PROJ/scripts/install.sh"
echo '{ "name": "notes-manager-web", "version": "1.0.0" }' > "$PROJ/package.json"
echo '{}' > "$PROJ/server/package.json"
for rel in $CRITICAL_SOURCES; do
  mkdir -p "$PROJ/$(dirname "$rel")"
  echo x > "$PROJ/$rel"
done

out=""
LAST_STATUS=0
run_installer() {
  LAST_STATUS=0
  out="$( cd "$PROJ" && bash scripts/install.sh "$@" 2>&1 )" || LAST_STATUS=$?
}

# cfg <label> - the value printed for a label in the resolved configuration
cfg() {
  printf '%s\n' "$out" | sed -n "s/^  $1  *//p" | head -n 1
}

# -- defaults, no .env ------------------------------------------------------- #
run_installer --check-config
check "runs without root and without a .env"  "$LAST_STATUS" "0"
check "the version is reported"                "$(cfg version)" "1.0.0"
check "port defaults to 8080"                 "$(cfg listen)" "0.0.0.0:8080"
check "storage driver defaults to auto"       "$(cfg 'storage driver')" "auto"
check "openlist root default"                 "$(cfg 'openlist root')" "/notes"
check "openlist url unset"                    "$(cfg 'openlist url')" "(not configured)"
check "openlist token unset"                  "$(cfg 'openlist token')" "(not set)"
check "admin user default"                    "$(cfg 'admin user')" "admin"
check "password marked as generated"          "$(cfg 'admin password')" "(will be generated)"
check "runtime file next to the install dir"  "$(cfg 'runtime .env')" "/opt/notes-manager/.env"
check "source .env reported as missing"       "$(cfg 'source .env')" "$PROJ/.env (not found - defaults are used)"

# -- values flow from .env --------------------------------------------------- #
cat > "$PROJ/.env" <<'ENV_FIXTURE'
PORT=9123
HOST=127.0.0.1
BASE_PATH=/notes
STORAGE_DRIVER=openlist
OPENLIST_URL=http://127.0.0.1:5244
OPENLIST_TOKEN=token-abc
OPENLIST_ROOT=/my-notes
OPENLIST_PER_USER=true
ADMIN_USERNAME=boss
ADMIN_PASSWORD=pw-from-dotenv
AUTH_LOCAL_ENABLED=false
DATA_DIR=./data
NOTES_ROOT=./data/notes
ENV_FIXTURE

run_installer --check-config
check "port comes from .env"                  "$(cfg listen)" "127.0.0.1:9123/notes"
check "storage driver comes from .env"        "$(cfg 'storage driver')" "openlist"
check "openlist url comes from .env"          "$(cfg 'openlist url')" "http://127.0.0.1:5244"
check "openlist root comes from .env"         "$(cfg 'openlist root')" "/my-notes"
check "per user comes from .env"              "$(cfg 'per user')" "true"
check "admin user comes from .env"            "$(cfg 'admin user')" "boss"
check "local auth comes from .env"            "$(cfg 'local auth')" "false"
check "token reported as set"                 "$(cfg 'openlist token')" "(set)"
check "password reported as set"              "$(cfg 'admin password')" "(set)"
check "relative DATA_DIR made absolute"       "$(cfg 'data dir')" "/var/lib/notes-manager"
check "relative NOTES_ROOT follows DATA_DIR"  "$(cfg 'notes root')" "/var/lib/notes-manager/notes"

# -- command line wins over .env --------------------------------------------- #
run_installer --check-config --port 9500 --driver local
check "command line port overrides .env"      "$(cfg listen)" "127.0.0.1:9500/notes"
check "command line driver overrides .env"    "$(cfg 'storage driver')" "local"

# -- absolute NOTES_ROOT is respected ---------------------------------------- #
echo 'NOTES_ROOT=/srv/notes' >> "$PROJ/.env"
run_installer --check-config
check "absolute NOTES_ROOT respected"         "$(cfg 'notes root')" "/srv/notes"

# -- invalid values are rejected with a clear message ------------------------ #
echo 'STORAGE_DRIVER=bogus' >> "$PROJ/.env"
run_installer --check-config
check "invalid driver rejected"               "$LAST_STATUS" "1"
check "  with an explanatory message"         "$(printf '%s' "$out" | grep -c 'storage driver must be one of')" "1"

# =========================================================================== #
# 5. dependency freshness                                                     #
# =========================================================================== #
# The real failure this guards against: node_modules is kept between installs,
# so a dependency added by "git pull" is missing, and "--skip-deps" then builds
# against a tree that cannot satisfy package.json. Adding
# @codemirror/language-data to web/package.json broke the Vite build that way.
echo ""
echo "dependency freshness"

DEPS="$WORK/deps"
mkdir -p "$DEPS/web" "$DEPS/server" "$DEPS/node_modules/@scope"
cat > "$DEPS/package.json" <<'PKG'
{ "name": "root", "workspaces": ["server", "web"] }
PKG
cat > "$DEPS/web/package.json" <<'PKG'
{ "name": "web", "dependencies": { "@codemirror/language-data": "^6.5.2" } }
PKG
cat > "$DEPS/server/package.json" <<'PKG'
{ "name": "server", "dependencies": { "express": "^5.1.0" } }
PKG
echo '{"name":"lock","lockfileVersion":3}' > "$DEPS/package-lock.json"

# --- the fingerprint -------------------------------------------------------- #
first="$(fingerprint_lock "$DEPS")"
check "lock fingerprint is stable"            "$(fingerprint_lock "$DEPS")" "$first"
echo '{"name":"lock","lockfileVersion":3,"changed":true}' > "$DEPS/package-lock.json"
check "lock fingerprint follows the file"     "$([ "$(fingerprint_lock "$DEPS")" != "$first" ] && echo changed)" "changed"
rm -f "$DEPS/package-lock.json"
check "no lock file is its own fingerprint"   "$(fingerprint_lock "$DEPS")" "no-lock-file"
echo '{"name":"lock","lockfileVersion":3}' > "$DEPS/package-lock.json"

# --- the gate --------------------------------------------------------------- #
if dependencies_are_current "$DEPS"; then
  printf '  FAIL  a tree with no recorded stamp is accepted\n'; FAILED=1
else
  printf '  ok    a tree with no recorded stamp is rejected\n'
fi

write_deps_stamp "$DEPS"
check "the stamp lands inside node_modules"   "$([ -f "$DEPS/node_modules/.notes-manager-lock" ] && echo yes)" "yes"
if dependencies_are_current "$DEPS"; then
  printf '  ok    a freshly stamped tree is accepted\n'
else
  printf '  FAIL  a freshly stamped tree is rejected\n'; FAILED=1
fi

# This is the exact sequence that broke the build: install, then pull a commit
# that changes package-lock.json, then re-run with --skip-deps.
echo '{"name":"lock","lockfileVersion":3,"added":"@codemirror/language-data"}' > "$DEPS/package-lock.json"
if dependencies_are_current "$DEPS"; then
  printf '  FAIL  a tree from an older lock file is accepted\n'; FAILED=1
else
  printf '  ok    a tree from an older lock file is rejected\n'
fi

# --- which packages are actually missing ------------------------------------ #
# The order follows the workspace list, which is not something worth pinning.
missing() { find_missing_dependencies "$DEPS" | LC_ALL=C sort | tr '\n' ' '; }
check "missing dependencies are named" "$(missing)" "@codemirror/language-data express "

mkdir -p "$DEPS/node_modules/express"
echo '{"name":"express"}' > "$DEPS/node_modules/express/package.json"
check "a hoisted package counts as installed" "$(missing)" "@codemirror/language-data "

mkdir -p "$DEPS/web/node_modules/@codemirror/language-data"
echo '{"name":"language-data"}' > "$DEPS/web/node_modules/@codemirror/language-data/package.json"
check "a nested package counts as installed"  "$(missing)" ""
check "a complete tree passes the gate again" "$(dependencies_are_current "$DEPS" && echo current)" ""

echo ""
echo "version reporting"

VPROJ="$WORK/version"
mkdir -p "$VPROJ"
printf '{ "name": "x",\n  "version": "2.3.4",\n  "engines": { "node": ">=20" }\n}\n' > "$VPROJ/package.json"
check "reads the version from package.json"   "$(read_project_version "$VPROJ")" "2.3.4"

echo '{ "name": "x" }' > "$VPROJ/package.json"
check "a package.json without one is unknown" "$(read_project_version "$VPROJ")" "unknown"

rm -f "$VPROJ/package.json"
check "a missing package.json is unknown"     "$(read_project_version "$VPROJ")" "unknown"

# The banner and the closing summary have to show it, not just the function.
check "the installer banner shows the version"  "$(grep -c 'notes-manager-web \$PROJECT_VERSION - installer' "$INSTALLER")" "1"
check "the closing summary shows the version"   "$(grep -c '版本 (version)' "$INSTALLER")" "1"

# =========================================================================== #
if [ "$FAILED" -eq 0 ]; then
  printf '\nInstaller tests passed\n'
else
  printf '\nInstaller tests FAILED\n'
  exit 1
fi
