# v5 Release Candidate Evidence Packet

Use this packet for each v5 release candidate before marking GA complete. Keep
links to GitHub workflow runs, release assets, screenshots, logs, and command
output artifacts here or in the linked GitHub issue. Do not paste secrets,
tokens, private keys, raw chat/task content, or unredacted local private paths.
The filled packet is the evidence target for #644.

## Candidate Identity

| Field                 | Value |
| --------------------- | ----- |
| RC label              |       |
| Release version       |       |
| Git tag               |       |
| Commit SHA            |       |
| GitHub release URL    |       |
| Desktop Release run   |       |
| Desktop Artifacts run |       |
| CI run                |       |
| Evidence owner        |       |
| Review date           |       |

Version checks:

- [ ] `package.json` version:
- [ ] `shared/package.json` version:
- [ ] `server/package.json` version:
- [ ] `web/package.json` version:
- [ ] `cli/package.json` version:
- [ ] `mcp/package.json` version:
- [ ] `desktop/package.json` version:
- [ ] `GET /api/health.version`:
- [ ] `vk --version`:
- [ ] MCP package/version output:

## Release Validation

Record command output locations or workflow URLs.

| Gate                                | Result | Evidence |
| ----------------------------------- | ------ | -------- |
| `pnpm install --frozen-lockfile`    |        |          |
| `pnpm typecheck`                    |        |          |
| `pnpm lint:budget`                  |        |          |
| `pnpm test:unit`                    |        |          |
| `pnpm build`                        |        |          |
| `pnpm validate:release`             |        |          |
| `pnpm validate:release -- --github` |        |          |
| `pnpm smoke:cli-mcp`                |        |          |
| `pnpm desktop:package:mac:unsigned` |        |          |
| `pnpm test:load`                    |        |          |

## macOS Artifact Inventory

Stable v5 GA requires signed and notarized macOS artifacts.

| Asset                  | URL | SHA-256 | Notes |
| ---------------------- | --- | ------- | ----- |
| signed DMG             |     |         |       |
| signed ZIP             |     |         |       |
| blockmap               |     |         |       |
| stable update metadata |     |         |       |
| source archive         |     |         |       |
| changelog entry        |     |         |       |

Notarization and Gatekeeper:

- [ ] `spctl --assess --type open --verbose` passed:
- [ ] Notarization log URL or artifact:
- [ ] Clean Mac install screenshot or recording:
- [ ] First-run profile/workspace data path verified:

## Signed Update And Rollback Drill

This section satisfies the evidence target for #649.

| Step                                     | Result | Evidence |
| ---------------------------------------- | ------ | -------- |
| Install signed baseline build            |        |          |
| Launch and verify local server health    |        |          |
| Publish or expose higher RC update       |        |          |
| Check for update from native menu        |        |          |
| Download update                          |        |          |
| Install update                           |        |          |
| Verify updated app/server/web versions   |        |          |
| Reinstall previous signed DMG            |        |          |
| Verify rollback behavior                 |        |          |
| Restore backup if schema is incompatible |        |          |
| Record admin recovery notes              |        |          |

Rollback notes:

```text

```

## Migration, Backup, And Restore

| Gate                                     | Result | Evidence |
| ---------------------------------------- | ------ | -------- |
| v4 file-backed backup preserved          |        |          |
| SQLite migration dry-run                 |        |          |
| SQLite migration run                     |        |          |
| Migration journal/report preserved       |        |          |
| Board/task/search/workflow/chat verified |        |          |
| Backup/export created                    |        |          |
| Restore/import verified                  |        |          |
| Older app refuses newer SQLite schema    |        |          |

Accepted migration risks:

```text

```

## Load, Remote, Mobile, And PWA Evidence

This section satisfies the evidence target for #646.

Full load profile:

| Field                | Value |
| -------------------- | ----- |
| Target origin        |       |
| Seed profile         |       |
| k6 command           |       |
| k6 output artifact   |       |
| HTTP p95             |       |
| HTTP error rate      |       |
| WebSocket error rate |       |
| Known scale ceiling  |       |

Remote/mobile smoke:

| Client               | Device/OS | Browser version | Result | Evidence |
| -------------------- | --------- | --------------- | ------ | -------- |
| Safari-class browser |           |                 |        |          |
| Chrome-class browser |           |                 |        |          |
| Installed PWA        |           |                 |        |          |

PWA stale-client checks:

- [ ] Static shell can load from cache:
- [ ] API data is not cached for offline replay:
- [ ] Offline writes are not queued:
- [ ] Stale client refresh blocks or refreshes before write:
- [ ] Same-origin `/api`, `/ws`, manifest, service worker, and static assets
      verified:

Known limits to include in release notes:

```text

```

## Security And Diagnostics

| Gate                                     | Result | Evidence |
| ---------------------------------------- | ------ | -------- |
| Security audit reviewed                  |        |          |
| Debug bundle redaction negative fixtures |        |          |
| Scoped API token smoke                   |        |          |
| Password-session boundary smoke          |        |          |
| WebSocket auth/reconnect smoke           |        |          |
| Support bundle contains no private data  |        |          |

Security release notes:

```text

```

## Visual Documentation And Media

The checked-in dummy-data docs media lives in
[v5 Visual Tour](V5-VISUAL-TOUR.md). Use this section to confirm the docs assets
still match the RC UI and to attach real RC screenshots or recordings.

| Surface                   | Docs asset                                 | RC proof |
| ------------------------- | ------------------------------------------ | -------- |
| Desktop board             | `docs/assets/v5/v5-board-overview.png`     |          |
| Board/workflow/audit GIF  | `docs/assets/v5/v5-board-to-workflow.gif`  |          |
| Task work view            | `docs/assets/v5/v5-task-work-view.png`     |          |
| Maintenance Center        | `docs/assets/v5/v5-maintenance-center.png` |          |
| Mobile/PWA board          | `docs/assets/v5/v5-mobile-pwa-board.png`   |          |
| Mobile/PWA navigation GIF | `docs/assets/v5/v5-mobile-pwa-flow.gif`    |          |

Visual docs notes:

```text

```

## Final Decision

| Question                                             | Answer |
| ---------------------------------------------------- | ------ |
| Are all critical/high v5 release blockers closed?    |        |
| Are all deferred items linked as post-GA issues?     |        |
| Are user-visible limits documented in release notes? |        |
| Is this RC approved for stable publication?          |        |

Decision notes:

```text

```
