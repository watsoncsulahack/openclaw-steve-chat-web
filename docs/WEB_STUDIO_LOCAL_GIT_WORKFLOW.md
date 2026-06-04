# Web Studio Local Git Workflow

Web Studio exposes a local replicated git checkout for each app in
`/storage/emulated/0/OpenClawHub/web/sites.json`. For Steve Chat, the source
repo is:

```text
/root/.openclaw/workspace/openclaw-steve-chat-web
```

The Web Studio-exposed copy is:

```text
/storage/emulated/0/OpenClawHub/web/steve-chat
```

The local workflow is source-first:

1. Make and commit changes in the source repo.
2. A git hook runs `scripts/sync_web_studio_repo.sh`.
3. The script finds the matching Web Studio app by `site.json` id.
4. It fetches the source commit into the exposed Web Studio copy.
5. It checks out the same branch and commit in the Web Studio copy.

This keeps Web Studio's revision picker local-git-clean while still letting the
source repo remain the place where implementation work and GitHub pushes happen.

The sync script refuses to overwrite a dirty Web Studio copy. If the exposed
copy has local edits, commit or discard those edits before syncing. When the
exposed branch previously pointed at a different commit, the script archives the
old branch tip under `webstudio-archive/...` before moving the branch.

Install the hooks locally with:

```bash
git config core.hooksPath .githooks
```

Run the sync manually with:

```bash
scripts/sync_web_studio_repo.sh
```
