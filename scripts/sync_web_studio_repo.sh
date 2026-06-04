#!/usr/bin/env bash
set -euo pipefail

SOURCE_REPO="${1:-}"
WEB_STUDIO_SITES_JSON="${WEB_STUDIO_SITES_JSON:-/storage/emulated/0/OpenClawHub/web/sites.json}"
WEB_STUDIO_SOURCE_REMOTE="${WEB_STUDIO_SOURCE_REMOTE:-__web_studio_source}"

log() {
  printf '[web-studio-sync] %s\n' "$*"
}

fail() {
  log "error: $*"
  exit 1
}

resolve_dir() {
  local path="$1"
  (cd "$path" >/dev/null 2>&1 && pwd) || return 1
}

if [[ -z "$SOURCE_REPO" ]]; then
  SOURCE_REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"
fi

[[ -n "$SOURCE_REPO" ]] || fail "source repo not provided and current directory is not inside a git repo"
SOURCE_REPO="$(resolve_dir "$SOURCE_REPO")" || fail "source repo does not exist: $SOURCE_REPO"
[[ -d "$SOURCE_REPO/.git" ]] || fail "source is not a git repo: $SOURCE_REPO"
[[ -f "$SOURCE_REPO/site.json" ]] || fail "source repo has no site.json with a Web Studio app id: $SOURCE_REPO"
[[ -f "$WEB_STUDIO_SITES_JSON" ]] || fail "Web Studio catalog not found: $WEB_STUDIO_SITES_JSON"
command -v jq >/dev/null 2>&1 || fail "jq is required to read Web Studio JSON catalogs"

SITE_ID="$(jq -r '.id // empty' "$SOURCE_REPO/site.json")"
[[ -n "$SITE_ID" ]] || fail "site.json does not contain an id: $SOURCE_REPO/site.json"

DEST_PATH="$(jq -r --arg id "$SITE_ID" '.[] | select(.id == $id) | .path' "$WEB_STUDIO_SITES_JSON" | head -n 1)"
[[ -n "$DEST_PATH" && "$DEST_PATH" != "null" ]] || fail "site id '$SITE_ID' is not exposed in $WEB_STUDIO_SITES_JSON"

if [[ ! -e "$DEST_PATH" ]]; then
  log "catalog path missing; cloning replicated repo to $DEST_PATH"
  mkdir -p "$(dirname "$DEST_PATH")"
  git clone "$SOURCE_REPO" "$DEST_PATH" >/dev/null
fi

DEST_PATH="$(resolve_dir "$DEST_PATH")" || fail "Web Studio repo path does not exist: $DEST_PATH"
[[ -d "$DEST_PATH/.git" ]] || fail "Web Studio path is not a git repo: $DEST_PATH"

if [[ "$SOURCE_REPO" == "$DEST_PATH" ]]; then
  log "Web Studio catalog already points at source repo; nothing to replicate for '$SITE_ID'"
  exit 0
fi

SOURCE_COMMIT="$(git -C "$SOURCE_REPO" rev-parse HEAD)"
SOURCE_SHORT="$(git -C "$SOURCE_REPO" rev-parse --short HEAD)"
SOURCE_BRANCH="$(git -C "$SOURCE_REPO" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"

DEST_DIRTY="$(git -C "$DEST_PATH" status --porcelain)"
if [[ -n "$DEST_DIRTY" && "${WEB_STUDIO_SYNC_ALLOW_DIRTY:-0}" != "1" ]]; then
  fail "Web Studio copy has local changes; refusing to overwrite $DEST_PATH"
fi

if git -C "$DEST_PATH" remote get-url "$WEB_STUDIO_SOURCE_REMOTE" >/dev/null 2>&1; then
  git -C "$DEST_PATH" remote set-url "$WEB_STUDIO_SOURCE_REMOTE" "$SOURCE_REPO"
else
  git -C "$DEST_PATH" remote add "$WEB_STUDIO_SOURCE_REMOTE" "$SOURCE_REPO"
fi

git -C "$DEST_PATH" fetch --quiet --tags "$WEB_STUDIO_SOURCE_REMOTE"

if ! git -C "$DEST_PATH" cat-file -e "$SOURCE_COMMIT^{commit}" 2>/dev/null; then
  fail "could not fetch source commit $SOURCE_SHORT into Web Studio copy"
fi

if [[ -n "$SOURCE_BRANCH" ]]; then
  DEST_BRANCH_SHA="$(git -C "$DEST_PATH" rev-parse --verify --quiet "refs/heads/$SOURCE_BRANCH" || true)"
  if [[ -n "$DEST_BRANCH_SHA" && "$DEST_BRANCH_SHA" != "$SOURCE_COMMIT" ]]; then
    ARCHIVE_BRANCH="webstudio-archive/${SOURCE_BRANCH}-$(git -C "$DEST_PATH" rev-parse --short "$DEST_BRANCH_SHA")-$(date -u +%Y%m%d%H%M%S)"
    git -C "$DEST_PATH" branch "$ARCHIVE_BRANCH" "$DEST_BRANCH_SHA" >/dev/null
    log "archived previous Web Studio $SOURCE_BRANCH at $ARCHIVE_BRANCH"
  fi

  git -C "$DEST_PATH" update-ref "refs/heads/$SOURCE_BRANCH" "$SOURCE_COMMIT"
  git -C "$DEST_PATH" checkout --quiet "$SOURCE_BRANCH"
  git -C "$DEST_PATH" reset --hard --quiet "$SOURCE_COMMIT"
else
  git -C "$DEST_PATH" checkout --quiet --detach "$SOURCE_COMMIT"
fi

log "replicated '$SITE_ID' from $SOURCE_REPO@$SOURCE_SHORT to $DEST_PATH"
