# Veritas Kanban Desktop Release

This guide covers the v5 macOS desktop packaging path: unsigned PR artifacts,
signed/notarized release artifacts, update metadata, and smoke testing.

## Local Commands

Run these from the repository root:

```bash
pnpm desktop:package:mac:dir
pnpm desktop:package:mac:unsigned
pnpm desktop:release:mac
```

`desktop:package:mac:dir` creates an unpacked local app for fast inspection.
`desktop:package:mac:unsigned` creates unsigned DMG/ZIP artifacts and update
metadata for PR validation. `desktop:release:mac` expects signing and
notarization credentials and publishes update metadata through electron-builder.

The package step builds the workspace, stages the production server runtime in
`desktop/.desktop-release/server`, stages the built web app in
`desktop/.desktop-release/web`, and writes artifacts to `desktop/release/`.
Both staging and release directories are ignored by git.

## GitHub Workflows

`Desktop Artifacts` runs on desktop/server/web/shared changes and on manual
dispatch. It builds unsigned macOS artifacts on `macos-15`, uploads the DMG,
ZIP, blockmap, and update YAML files, and does not require Apple credentials.

`Desktop Release` runs on manual dispatch or a published GitHub release. It
requires the signing secrets below, builds signed/notarized macOS artifacts,
and publishes update metadata with the GitHub provider.

## Required Release Secrets

Configure these repository secrets before running `Desktop Release`:

- `MACOS_CSC_LINK`: base64 encoded `.p12` Developer ID Application certificate
  or a secure URL accepted by electron-builder `CSC_LINK`.
- `MACOS_CSC_KEY_PASSWORD`: password for the `.p12` signing identity.
- `APPLE_ID`: Apple Developer account email for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple Developer team ID.

The workflow maps those secrets to electron-builder's `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` environment variables.

## Update Channels

The app uses `electron-updater` with manual download/install behavior:

- `stable`: default packaged release channel.
- `beta`: prerelease/test channel.
- `dev`: explicit development channel for controlled test metadata.

Set `VERITAS_UPDATE_CHANNEL=stable|beta|dev` in release workflows or local
packaged test runs. Dev-mode update checks remain unsupported unless
`VERITAS_DESKTOP_UPDATER_FORCE_DEV=true` is set with a valid dev update config.

The native desktop bridge exposes update status events for checking,
available, downloading, ready, failed, and unsupported states. The menu enables
download only when an update is available and install only when an update has
downloaded.

## Release Checklist

- Bump all workspace package versions together.
- Update `CHANGELOG.md`.
- Run `pnpm typecheck`, `pnpm lint:budget`, `pnpm build`, and
  `pnpm test:unit`.
- Run `pnpm desktop:package:mac:unsigned` and inspect artifact names.
- Run `Desktop Artifacts` and download the uploaded DMG/ZIP/update metadata.
- Run `Desktop Release` only after Apple signing secrets are configured.
- Confirm notarization succeeds and the DMG installs without Gatekeeper
  warnings on a clean Mac.
- Confirm a first run creates the profile/workspace app data directories.
- Confirm update check, download, install, failed-download, and rollback paths
  on the selected channel.

## Smoke Tests

Unsigned PR artifact:

1. Download `veritas-kanban-mac-unsigned` from the workflow run.
2. Mount the DMG and drag Veritas Kanban into `/Applications`.
3. For unsigned local artifacts only, use right-click Open or remove quarantine
   with `xattr -dr com.apple.quarantine "/Applications/Veritas Kanban.app"`.
4. Launch the app and confirm the desktop status page reaches the local app.
5. Confirm app data appears under
   `~/Library/Application Support/@veritas-kanban/desktop/profiles/default/workspaces/local/`.

Signed release artifact:

1. Install the DMG on a clean Mac.
2. Launch normally. There should be no Gatekeeper warning.
3. Confirm local server health through the desktop UI and logs.
4. Check for updates from the native menu.
5. Publish a higher test-channel build, then confirm available, downloading,
   ready, and install states.

Rollback:

1. Quit Veritas Kanban.
2. Install the previous signed DMG.
3. Launch and confirm the existing profile/workspace data is preserved.
4. If an update artifact is bad, remove or supersede the affected GitHub
   release assets and publish corrected update metadata.

## Future Targets

Linux and Windows packages are intentionally not v5 Mac GA blockers. The
current packaging config keeps artifact naming and update-channel conventions
portable, but Windows signing, Linux package formats, auto-launch behavior, and
OS-specific smoke tests should be handled in follow-up issues.
