# Web To Mac Desktop Migration

This guide moves an existing Veritas Kanban board from a source checkout or an
already-populated desktop SQLite database into the signed macOS app.

Use it when `/Applications/Veritas Kanban.app` should become the only owner of
`localhost:3001`. The Homebrew cask installs the app, but it does not stop an old
development server, disable an old watchdog, or update automation credentials.

## Choose The Correct Path

Run the inventory on the Mac that will own the desktop workspace. Record each
host separately; counts reported by another Mac, server, or backup are context,
not proof of the target Mac's active database.

Check the desktop database before importing anything. Quit the app first so the
direct inspection does not race the authoritative writer:

```bash
osascript -e 'quit app "Veritas Kanban"' 2>/dev/null || true
sleep 2

DESKTOP_ROOT="$HOME/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local"
TARGET_DB="$DESKTOP_ROOT/data/.veritas-kanban/veritas.db"

if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3001 still has a listener. Stop it before inspecting the database." >&2
  exit 1
fi

if test -f "$TARGET_DB" && lsof "$TARGET_DB" >/dev/null 2>&1; then
  echo "The desktop database is still open. Stop its owner before continuing." >&2
  exit 1
fi

if test -f "$TARGET_DB"; then
  sqlite3 "$TARGET_DB" "
  select 'tasks', count(*) from tasks where deleted_at is null
  union all select 'squad_messages', count(*) from squad_messages
  union all select 'telemetry_events', count(*) from telemetry_events
  union all select 'workflow_definitions', count(*) from workflow_definitions
  union all select 'workflow_runs', count(*) from workflow_runs;
  "
else
  echo "No desktop database exists yet."
fi
```

Then use exactly one path:

| Current state                                                              | Path                                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The desktop database already contains the expected data                    | Follow **Already Migrated Desktop Data**. Do not import, restore, or rerun file-to-SQLite migration.               |
| The desktop database is empty or disposable and the old repo has file data | Follow **File-Backed Source To Desktop SQLite**. Create a staging database while the desktop app is fully stopped. |
| You have a governed Veritas SQLite export bundle                           | Follow **Governed Backup Bundle Import**. The target replacement is explicit and destructive.                      |
| You only want a new empty board                                            | Launch the app and choose **Board Only**.                                                                          |

In v5.2.5, the onboarding **Restore Backup** card is recovery preflight only. It
opens the native bundle picker but does not import the selected bundle during
onboarding. Complete or sign in to a local setup, then follow **Governed Backup
Bundle Import** or use the documented `/api/v1/sqlite/import` endpoint. The card
is not the right choice when the expected records are already present in the
desktop database.

## Desktop Paths And Runtime Ownership

Default desktop workspace:

```text
~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/
```

Default desktop SQLite database:

```text
~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/data/.veritas-kanban/veritas.db
```

Before accepting any cutover, identify the process that owns port `3001`:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
ps -o pid,ppid,pgid,command -p "$(lsof -tiTCP:3001 -sTCP:LISTEN)"
```

After cutover, the process tree should resolve through:

```text
/Applications/Veritas Kanban.app/Contents/MacOS/veritas-kanban
/Applications/Veritas Kanban.app/Contents/Resources/server/dist/index.js
```

Only one VK server should accept active writes during the cutover.

## Wait For The Desktop Server

`open -a` asks LaunchServices to open the app and returns before Electron and
the bundled server are necessarily ready. An immediate failed `curl` is not
proof that startup failed. Do not replace the readiness check with a fixed
`sleep`; startup time varies by host.

From a Veritas Kanban checkout, launch the app and wait up to 30 seconds for the
exact installed version:

```bash
EXPECTED_VERSION="$(defaults read "/Applications/Veritas Kanban.app/Contents/Info" CFBundleShortVersionString)"
open -a "Veritas Kanban"
pnpm desktop:wait:ready -- --expected-version "$EXPECTED_VERSION"
```

Homebrew-only operators and agents can use the built-in macOS tools instead:

```bash
EXPECTED_VERSION="$(defaults read "/Applications/Veritas Kanban.app/Contents/Info" CFBundleShortVersionString)"
HEALTH_URL="http://127.0.0.1:3001/api/health"
HEALTH_JSON=""
DESKTOP_READY=0
DESKTOP_DEADLINE=$((SECONDS + 30))

open -a "Veritas Kanban"

while ((SECONDS < DESKTOP_DEADLINE)); do
  REMAINING_SECONDS=$((DESKTOP_DEADLINE - SECONDS))

  if HEALTH_JSON="$(curl -fsS --max-time "$REMAINING_SECONDS" "$HEALTH_URL" 2>/dev/null)"; then
    HEALTH_OK="$(printf '%s' "$HEALTH_JSON" | plutil -extract ok raw -o - - 2>/dev/null || true)"
    HEALTH_SERVICE="$(printf '%s' "$HEALTH_JSON" | plutil -extract service raw -o - - 2>/dev/null || true)"
    HEALTH_VERSION="$(printf '%s' "$HEALTH_JSON" | plutil -extract version raw -o - - 2>/dev/null || true)"
    PORT_PID="$(lsof -tiTCP:3001 -sTCP:LISTEN 2>/dev/null || true)"
    PORT_COMMAND="$(ps -o command= -p "$PORT_PID" 2>/dev/null || true)"

    if test "$HEALTH_OK" = "true" &&
      test "$HEALTH_SERVICE" = "veritas-kanban" &&
      test "$HEALTH_VERSION" = "$EXPECTED_VERSION" &&
      printf '%s' "$PORT_COMMAND" | grep -Fq "/Applications/Veritas Kanban.app/Contents/"; then
      printf '%s\n' "$HEALTH_JSON"
      DESKTOP_READY=1
      break
    fi
  fi

  sleep 0.5
done

if test "$DESKTOP_READY" -ne 1; then
  echo "Veritas Kanban $EXPECTED_VERSION did not become ready at $HEALTH_URL." >&2
  lsof -nP -iTCP:3001 -sTCP:LISTEN || true
  ps -o pid,ppid,pgid,command -p "$(lsof -tiTCP:3001 -sTCP:LISTEN)" 2>/dev/null || true
  tail -n 80 "$HOME/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/logs/server.log" 2>/dev/null || true
  exit 1
fi
```

The version and listener-owner checks prevent a stale source server or an older
desktop process from satisfying upgrade verification. If another process owns
`3001`, the desktop app may select another loopback port for its renderer. That
fallback can keep the UI usable, but it is not an accepted migration cutover:
stop the competing writer, relaunch the desktop app, and prove that the packaged
server owns `3001`.

## Already Migrated Desktop Data

Use this path when a migration tool or operator has already populated
`veritas.db`.

1. Record the counts from **Choose The Correct Path**.
2. Confirm that a recoverable backup exists. If the app is running, create a
   governed export in Settings -> Maintenance. For a raw database snapshot,
   quit the app first and copy the database only while no process owns it:

   ```bash
   osascript -e 'quit app "Veritas Kanban"' 2>/dev/null || true
   sleep 2

   DESKTOP_ROOT="$HOME/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local"
   TARGET_DB="$DESKTOP_ROOT/data/.veritas-kanban/veritas.db"
   TARGET_BACKUP="$DESKTOP_ROOT/backups/pre-upgrade-$(date +%Y%m%d-%H%M%S)"

   if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
     echo "Port 3001 still has a listener. Stop it before backing up." >&2
     exit 1
   fi

   if test -f "$TARGET_DB" && lsof "$TARGET_DB" >/dev/null 2>&1; then
     echo "The desktop database is still open. Stop its owner before backing up." >&2
     exit 1
   fi

   mkdir -p "$TARGET_BACKUP"
   test -f "$TARGET_DB" && ditto "$TARGET_DB" "$TARGET_BACKUP/veritas.db"
   test -f "$TARGET_DB-wal" && ditto "$TARGET_DB-wal" "$TARGET_BACKUP/veritas.db-wal"
   test -f "$TARGET_DB-shm" && ditto "$TARGET_DB-shm" "$TARGET_BACKUP/veritas.db-shm"
   ```

3. Install or upgrade the signed app:

   ```bash
   brew tap BradGroux/tap
   brew upgrade --cask veritas-kanban || brew install --cask veritas-kanban
   open -a "Veritas Kanban"
   ```

   Then run **Wait For The Desktop Server**. Do not issue one immediate health
   request after `open -a`.

4. On first launch, choose **Use Existing Data**. The setup screen displays
   representative record counts read from the active desktop SQLite database.
5. Select **Secure Existing Data**, create the admin password, and save the
   recovery key. This secures the current database without replacing its board
   records or imported owner metadata.
6. Verify the board and compare the post-upgrade counts with the recorded
   counts. Do not use the onboarding **Restore Backup** card to replace data; it
   does not perform an import. Actual replacement is available in Settings ->
   Maintenance and through `/api/v1/sqlite/import`.

If setup was interrupted, relaunch the app. A populated database remains on the
existing-data path; it should not be presented as a new empty board.

## Governed Backup Bundle Import

Use this path only when a completed Veritas SQLite export bundle is the intended
source of truth.

1. Preserve the current desktop target using the stopped-app backup procedure
   in **Already Migrated Desktop Data**.
2. Launch the app:
   - For an empty target, choose **Board Only** and create the admin password.
   - For a populated target with incomplete setup, choose **Use Existing Data**
     and secure it.
   - For a configured target, sign in normally.
     Then open Settings -> Maintenance.
3. In the SQLite backup/import section, enter:
   - **SQLite database path**:
     `~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/data/.veritas-kanban/veritas.db`
   - **Bundle directory**: the export directory containing `manifest.json` and
     `data/sqlite/`
   - **Replace existing SQLite rows**: enabled
4. Select **Import Backup** and wait for the completed report.

The replacement checkbox is required because setup seeds configuration rows and
a populated target already has governed data, so the default non-replacing
import rejects either target as non-empty. Enabling it deletes and replaces the
governed SQLite table rows inside a transaction. It overwrites any target-only
board, configuration, identity, workflow, chat, telemetry, and audit data
represented by those tables. Proceed only when the bundle is authoritative and
the stopped-app target backup is recoverable.

After import, restart the app to clear runtime caches. If setup is presented
again, choose **Use Existing Data** and secure the imported database. Then run
the verification steps below.

## File-Backed Source To Desktop SQLite

Use this path only when the old source checkout still contains the authoritative
file-backed data under `tasks/` and `.veritas-kanban/`.

The safe cutover has four phases:

1. identify and stop the authoritative writer
2. preserve the quiescent file-backed source
3. create and validate a staging SQLite database with an isolated temporary
   server
4. stop every writer, install the staged database, and launch the desktop app

Do not run `/api/v1/sqlite/migration/run` against the live desktop
`veritas.db`. The desktop server already has that database open. Do not copy a
live WAL database as a backup.

### 1. Identify The Source, Server, And Watchdog

Start with the listener rather than assuming a checkout path:

```bash
VK_PID="$(lsof -tiTCP:3001 -sTCP:LISTEN | head -1)"

if test -n "$VK_PID"; then
  ps -ww -o pid,ppid,pgid,command -p "$VK_PID"
  lsof -a -p "$VK_PID" -d cwd -Fn
fi
```

The `cwd` line begins with `n` and identifies the listener's working directory.
Use the repository root that contains both `tasks/` and `.veritas-kanban/`:

```bash
SOURCE_ROOT="/absolute/path/from-the-process-inspection"
test -f "$SOURCE_ROOT/pnpm-workspace.yaml"
test -d "$SOURCE_ROOT/tasks"
test -d "$SOURCE_ROOT/.veritas-kanban"
```

Search user LaunchAgents and running service metadata for the same resolved
checkout path:

```bash
launchctl print "gui/$(id -u)" | rg -i 'veritas|kanban|watchdog' -C 2
rg -l "$SOURCE_ROOT|dev-watchdog|veritas-kanban" \
  "$HOME/Library/LaunchAgents" --glob '*.plist'
```

Inspect the matching plist before changing it. If it is the obsolete source
watchdog, derive its label and disable only that exact service:

```bash
WATCHDOG_PLIST="/absolute/path/to/the-confirmed-source-watchdog.plist"
plutil -p "$WATCHDOG_PLIST"
WATCHDOG_LABEL="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$WATCHDOG_PLIST")"

launchctl bootout "gui/$(id -u)" "$WATCHDOG_PLIST"
launchctl disable "gui/$(id -u)/$WATCHDOG_LABEL"
```

Gracefully stop the old server from its owning shell or supervisor, then quit
the desktop app:

```bash
osascript -e 'quit app "Veritas Kanban"' 2>/dev/null || true
sleep 2

if lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 3001 still has a listener. Stop it before backing up." >&2
  exit 1
fi
```

Do not disable unrelated production supervisors or remote deployments.

### 2. Preserve The Quiescent Source

Create the backup only after the old writer and its watchdog are stopped:

```bash
SOURCE_BACKUP="$HOME/Library/Application Support/@veritas-kanban/manual-migration-backups/pre-desktop-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$SOURCE_BACKUP"
ditto "$SOURCE_ROOT/tasks" "$SOURCE_BACKUP/tasks"
ditto "$SOURCE_ROOT/.veritas-kanban" "$SOURCE_BACKUP/.veritas-kanban"
```

Keep the source checkout and this backup until the desktop board is accepted.

### 3. Start A Temporary File-Storage Migration Server

Use a current Veritas Kanban checkout that includes the v5 SQLite migration API.
Run it on loopback port `3101`, not on the desktop port. Its own file storage is
an isolated empty temporary directory, so background services cannot mutate the
source being migrated:

```bash
cd "$SOURCE_ROOT"
corepack pnpm install --frozen-lockfile
MIGRATION_RUNTIME="$(mktemp -d /tmp/veritas-kanban-migration-runtime.XXXXXX)"

HOST=127.0.0.1 \
PORT=3101 \
NODE_ENV=development \
VERITAS_STORAGE=file \
DATA_DIR="$MIGRATION_RUNTIME" \
VERITAS_DATA_DIR="$MIGRATION_RUNTIME" \
VERITAS_DISABLE_WATCHERS=1 \
VERITAS_AUTH_ENABLED=true \
VERITAS_AUTH_LOCALHOST_BYPASS=true \
VERITAS_AUTH_LOCALHOST_ROLE=admin \
corepack pnpm --filter @veritas-kanban/server dev
```

Keep this foreground process visible. The admin bypass is limited to the
temporary loopback development server and disappears when the process exits.

In a second terminal:

```bash
curl -fsS http://127.0.0.1:3101/api/health | jq .
```

### 4. Dry Run Into A Staging Path

The dry run scans the source without creating or mutating the staging database:

```bash
SOURCE_ROOT="/absolute/path/confirmed-in-step-1"
DESKTOP_ROOT="$HOME/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local"
STAGING_ROOT="$DESKTOP_ROOT/import-staging/$(date +%Y%m%d-%H%M%S)"
STAGING_DB="$STAGING_ROOT/veritas.db"
JOURNAL="$STAGING_ROOT/file-to-sqlite-migration-journal.json"
SOURCE_MIGRATION_BACKUP="$STAGING_ROOT/file-storage-pre-sqlite-import"

mkdir -p "$STAGING_ROOT"

curl -fsS -X POST http://127.0.0.1:3101/api/v1/sqlite/migration/dry-run \
  -H "Content-Type: application/json" \
  -d "{
    \"sourceRoot\": \"$SOURCE_ROOT\",
    \"sqlitePath\": \"$STAGING_DB\",
    \"journalPath\": \"$JOURNAL\"
  }" | tee "$STAGING_ROOT/dry-run-report.json" | jq .
```

Stop and investigate active-task parse failures or unreadable source
directories. Optional malformed records, missing old attachments, and duplicate
archived IDs may be acceptable only when the report shows deterministic skips
and the retained data is complete. Backup, SQLite open, write, and promote
failures occur during the run step and always stop the cutover.

### 5. Create The Staging Database

After accepting the dry-run report:

```bash
curl -fsS -X POST http://127.0.0.1:3101/api/v1/sqlite/migration/run \
  -H "Content-Type: application/json" \
  -d "{
    \"sourceRoot\": \"$SOURCE_ROOT\",
    \"sqlitePath\": \"$STAGING_DB\",
    \"backupDir\": \"$SOURCE_MIGRATION_BACKUP\",
    \"journalPath\": \"$JOURNAL\"
  }" | tee "$STAGING_ROOT/import-report.json" | jq .
```

Stop the temporary server with `Ctrl-C`. Confirm neither `3001` nor `3101` has
a listener before touching the desktop target:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:3101 -sTCP:LISTEN
```

Checkpoint and validate the closed staging database:

```bash
sqlite3 "$STAGING_DB" "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA quick_check;"
```

The final line must be `ok`.

### 6. Back Up And Install The Staged Database

With all writers stopped:

```bash
TARGET_DB="$DESKTOP_ROOT/data/.veritas-kanban/veritas.db"
TARGET_BACKUP="$DESKTOP_ROOT/backups/pre-cutover-$(date +%Y%m%d-%H%M%S)"

if test -f "$TARGET_DB" && lsof "$TARGET_DB" >/dev/null 2>&1; then
  echo "The desktop database is still open. Stop its owner before cutover." >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_DB")" "$TARGET_BACKUP"
test -f "$TARGET_DB" && mv "$TARGET_DB" "$TARGET_BACKUP/veritas.db"
test -f "$TARGET_DB-wal" && mv "$TARGET_DB-wal" "$TARGET_BACKUP/veritas.db-wal"
test -f "$TARGET_DB-shm" && mv "$TARGET_DB-shm" "$TARGET_BACKUP/veritas.db-shm"
install -m 600 "$STAGING_DB" "$TARGET_DB"
```

Preserve:

- `dry-run-report.json`
- `import-report.json`
- `file-to-sqlite-migration-journal.json`
- `file-storage-pre-sqlite-import/`
- the pre-cutover desktop database backup
- the old source checkout and manual source backup

### 7. Launch And Secure Existing Data

```bash
open -a "Veritas Kanban"
```

Run **Wait For The Desktop Server** before treating the new database as active.

Choose **Use Existing Data**, then **Secure Existing Data**. Create the admin
password and save the recovery key. Do not choose **Board Only** or **Restore
Backup** for the staged database.

## Verify The Cutover

After **Wait For The Desktop Server** succeeds, confirm the packaged app owns
`3001`:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
ps -o pid,ppid,pgid,command -p "$(lsof -tiTCP:3001 -sTCP:LISTEN)"
```

Verify counts only after closing the app or by using the app/API. Do not use
direct SQLite reads as a routine concurrent inspection method for the
authoritative database.

Smoke these surfaces:

- board and task detail
- search
- workflows and workflow runs
- squad chat history
- telemetry/analytics
- Settings -> Maintenance storage health
- backup/export preview
- authenticated local automation

After creating a scoped API token in Settings with `task:read`,
`workflow:read`, and `telemetry:read`, representative API checks are:

```bash
export VK_API_URL="http://127.0.0.1:3001"
export VK_API_KEY="paste-scoped-token-here"

curl -fsS -H "X-API-Key: $VK_API_KEY" "$VK_API_URL/api/tasks/counts" | jq .
curl -fsS -H "X-API-Key: $VK_API_KEY" "$VK_API_URL/api/tasks?limit=1" | jq .
curl -fsS -H "X-API-Key: $VK_API_KEY" "$VK_API_URL/api/workflows" | jq .
curl -fsS -H "X-API-Key: $VK_API_KEY" "$VK_API_URL/api/telemetry/count" | jq .
curl -fsS -H "X-API-Key: $VK_API_KEY" "$VK_API_URL/api/chat/squad?limit=1" | jq .
```

Do not delete the old source until the counts and representative records are
accepted.

## Update Local Automation

Packaged desktop mode keeps auth enabled. Scripts, agents, MCP servers, and
scheduled jobs that previously wrote to unauthenticated localhost must send a
scoped API token:

```bash
export VK_API_URL="http://127.0.0.1:3001"
export VK_API_KEY="paste-scoped-token-here"
```

Store long-lived tokens in the operator's normal secret manager. Do not
hard-code owner/admin keys into repo scripts.

Heartbeat or service recovery should reopen the desktop app and wait for the
readiness gate:

```bash
EXPECTED_VERSION="$(defaults read "/Applications/Veritas Kanban.app/Contents/Info" CFBundleShortVersionString)"
open -a "Veritas Kanban"
pnpm desktop:wait:ready -- --expected-version "$EXPECTED_VERSION"
```

Use the Homebrew-only readiness block above when the automation does not have a
Veritas Kanban checkout. Pause any heartbeat or supervisor before quitting the
app for migration or upgrade. Resume it only after exact-version readiness
succeeds. It should not restart the old source checkout unless the operator
explicitly wants development mode.

## Rollback

Before acceptance:

1. Quit the Mac app.
2. Move the new target database and any sidecars into a retained incident
   directory.
3. Restore the pre-cutover desktop database and its matching sidecars, or
   restart the old file-backed server if that remains the chosen source of
   truth.
4. Verify board, task detail, search, workflows, chat, settings, and automation.

API restore from the migration-created source backup is documented in
[`MIGRATION-RECOVERY.md`](MIGRATION-RECOVERY.md). Do not use destructive SQLite
down migrations as the GA rollback path.

## Troubleshooting

### The setup screen offers Board Only instead of Use Existing Data

Quit the app and verify that `TARGET_DB` resolves to the default desktop
workspace and contains non-seed rows. Confirm that the staging database was
installed after every server stopped. Do not continue with Board Only until the
path and counts are understood.

### Homebrew app opens but the old board or server appears

Check who owns `3001`. If it is `node`, `tsx`, `vite`, or `pnpm dev` from the
source checkout, the desktop app is not authoritative. Stop that process and
its watchdog, then relaunch the app.

### `open -a` returns but port 3001 refuses connections

Run **Wait For The Desktop Server**. A refusal during the first few seconds is a
normal asynchronous launch window. If the bounded wait times out, inspect the
reported port owner and desktop server log. Do not restart the old source server
as a workaround.

### APIs return `AUTH_REQUIRED`

This is expected in packaged mode. Use the desktop UI session or a scoped token
with `X-API-Key` or `Authorization: Bearer`.

### The app does not bind `3001`

Inspect the desktop log:

```bash
tail -200 "$HOME/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/logs/server.log"
```

Common causes are another process on `3001`, corrupt desktop secret state, an
unsafe SQLite filesystem, or a server startup failure.

### The dry run reports duplicate task IDs

Stop the cutover. A duplicate ID is not reported as a skipped record; a later
active, archived, or backlog record can replace the earlier record and determine
its final state. The warning names the duplicated ID, not every file. Locate all
matching source records:

```bash
DUPLICATE_TASK_ID="task_id_from_the_warning"
rg -l -F "$DUPLICATE_TASK_ID" \
  "$SOURCE_ROOT/tasks/active" \
  "$SOURCE_ROOT/tasks/archive" \
  "$SOURCE_ROOT/tasks/backlog" \
  --glob '*.md'
```

Inspect every result, decide which record is authoritative, and give any
distinct task a unique ID. Preserve the original files, then rerun the dry run
and migration into a new staging database. Do not accept a run that still
reports duplicate task IDs.

### The dry run reports a missing attachment

The task metadata can migrate while the referenced attachment file remains
absent. Restore the file at the exact `source` path in the warning, or explicitly
remove the stale attachment reference after confirming the binary is
unrecoverable. Rerun into a new staging database and open representative
attachments before accepting the cutover.

### Counts are lower than expected

Compare the dry-run report, import report, setup-screen counts, and
post-migration API counts. Parsed migration counts exclude malformed source
records, while setup task counts exclude soft-deleted tasks. Check each warning
and keep all rollback artifacts until the difference is explained.
