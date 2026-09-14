#!/usr/bin/env bash
# =============================================================================
#  Regression test for the installer's file-copy step.
# =============================================================================
#  It extracts verify_tree() and copy_application() out of install.sh and runs
#  the real implementation against a synthetic source tree, so the failure that
#  bit twice - a nested "openlist" directory silently dropped from the copy -
#  cannot come back unnoticed.
#
#    bash scripts/test-install-copy.sh
# =============================================================================
set -Eeuo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$HERE/install.sh"
[ -f "$INSTALLER" ] || { echo "install.sh not found next to this script" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- stubs for the parts of install.sh we do not want to run --------------- #
C_RED=""; C_RESET=""
die() { printf '[test] die: %s\n' "$*" >&2; return 1; }

# extract_function <name> - prints the body of a top level shell function
extract_function() {
  awk -v fn="$1" '
    $0 ~ "^" fn "\\(\\) \\{" { inside = 1 }
    inside { print }
    inside && /^}$/ { exit }
  ' "$INSTALLER"
}

for fn in verify_tree copy_application; do
  body="$(extract_function "$fn")"
  [ -n "$body" ] || { echo "could not extract $fn() from install.sh" >&2; exit 1; }
  eval "$body"
done

# the list of sources verify_tree() insists on
critical="$(sed -n '/^CRITICAL_SOURCES="/,/^"$/p' "$INSTALLER")"
[ -n "$critical" ] || { echo "could not extract CRITICAL_SOURCES from install.sh" >&2; exit 1; }
eval "$critical"

# --- build a synthetic source tree ----------------------------------------- #
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

# --- run the real implementation ------------------------------------------- #
copy_application "$SRC" "$DST"
verify_tree "$DST" "copied tree"

# --- assertions ------------------------------------------------------------- #
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

# verify_tree must also fail loudly on an incomplete tree
rm -f "$DST/server/src/integrations/openlist/client.ts"
if verify_tree "$DST" "broken tree" >/dev/null 2>&1; then
  printf '  FAIL  verify_tree accepts a tree with missing sources\n'
  FAILED=1
else
  printf '  ok    verify_tree rejects a tree with missing sources\n'
fi

if [ "$FAILED" -eq 0 ]; then
  printf '\nInstaller copy test passed\n'
else
  printf '\nInstaller copy test FAILED\n'
  exit 1
fi
