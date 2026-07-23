# v5 SQLite Migration Recovery

This document defines the v5 file-to-SQLite rollback and failed-upgrade drill.

For a complete packaged Mac cutover, including the already-populated desktop
case, use
[`WEB-TO-MAC-DESKTOP-MIGRATION.md`](WEB-TO-MAC-DESKTOP-MIGRATION.md). Never run
file-to-SQLite migration against the authoritative database while the desktop
server has it open, and never copy a live WAL database as a backup.

## Recovery Contract

The v5 migration must never leave a project in a state where neither file
storage nor SQLite can be opened. The file-backed source remains the recovery
source of truth until the migrated SQLite database is accepted.

Every non-dry-run migration writes a JSON journal at
`.veritas-kanban/sqlite-migration-journal.json` unless an explicit
`journalPath` is supplied. The journal records:

- source root, target SQLite path, temporary SQLite path, and backup path
- started and updated timestamps
- current stage and completed stages
- scanned/written/skipped entity counts
- warnings for malformed source records, duplicate task IDs, missing attachment
  files, and backup copy issues
- failure name, message, and failed stage when migration fails
- safe-mode recommendation, next actions, and artifacts to preserve

## Failure Behavior

Migration stages are checkpointed as `scan-source`, `create-backup`,
`open-sqlite`, `write-sqlite`, `promote-database`, and `completed`.

If migration fails:

1. Keep the app on file storage.
2. Treat the project as `file-readonly` until a backup or retry path is chosen.
3. Preserve the journal, pre-migration backup, failed SQLite database, and any
   temporary SQLite files.
4. Show the failed stage, backup path, and next action to the admin.
5. Retry migration only after preserving the failed artifacts.

Interrupted migrations that were writing a new SQLite database use a temporary
database path and promote it only after writes and checkpointing complete. A
failed temporary database is removed after journaling the failure.

For desktop cutover, migrate into a fresh staging database with the desktop app
stopped. After the migration process closes the database, checkpoint it, run
`PRAGMA quick_check`, and install it only while no process owns the desktop
target. If the desktop database already contains the expected records, do not
rerun migration. Back it up and use the first-launch **Use Existing Data** path.

## Restore Drill

The rollback drill restores the file-backed state from the pre-migration backup:

```text
POST /api/v1/sqlite/migration/restore-backup
```

Recommended sequence:

1. Call restore with `dryRun: true` and confirm the target root and restored
   file count.
2. Stop the app or keep it in recovery mode.
3. Restore with `replaceExisting: true`.
4. Boot with `VERITAS_STORAGE=file`.
5. Verify board, task detail, search, workflow, chat, and admin settings.
6. Preserve the failed SQLite database and journal until the incident is closed.

The restore endpoint only restores `tasks/` and `.veritas-kanban/` from the
pre-migration backup. It does not attempt destructive SQLite down migrations.

## Downgrade Policy

For pre-GA v5 testing, schema `down` migrations may exist to support developer
iteration and controlled drills.

For GA users, rollback means restoring the pre-migration file-backed backup.
Indefinite downgrade from all future v5 SQLite schema versions is unsupported.
If an older app sees a newer SQLite database, it must refuse normal startup,
report the schema version, and direct the admin to restore the pre-migration
backup or use a compatible newer app. The runtime enforces this with
`PRAGMA user_version` and active `schema_migrations` checks; newer schema
refusals use the `SQLITE_UNSUPPORTED_SCHEMA` error code.

## Support Bundle Contents

When support is needed, preserve:

- migration journal
- migration report response
- pre-migration backup manifest
- failed SQLite database, WAL, and SHM files
- temporary SQLite database if one remains
- server logs around the migration window
- redacted config and environment summary

Do not include plaintext secrets, API tokens, cookies, or private keys.
