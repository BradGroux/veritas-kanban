# Veritas Kanban Desktop Release

This guide covers desktop packaging paths for macOS GA artifacts and
Linux/Windows preview artifact scaffolding: unsigned PR artifacts, signed
release artifacts, update metadata, and smoke testing.

For v5 GA, macOS is the only supported desktop release target. Linux and
Windows artifacts are unsigned preview artifacts for post-GA validation unless a
later release guide explicitly promotes the platform.

## Local Commands

Run these from the repository root:

```bash
pnpm desktop:package:mac:dir
pnpm desktop:package:mac:unsigned
pnpm desktop:package:linux:unsigned
pnpm desktop:package:windows:unsigned
pnpm desktop:release:mac
pnpm desktop:release:linux
pnpm desktop:release:windows
```

`desktop:package:mac:dir` creates an unpacked local app for fast inspection.
`desktop:package:mac:unsigned` creates unsigned DMG/ZIP artifacts and update
metadata for PR validation. `desktop:package:linux:unsigned` creates preview
x64 AppImage, deb, and rpm artifacts. `desktop:package:windows:unsigned`
creates preview x64 NSIS installer and ZIP artifacts.

`desktop:release:mac` expects Apple signing and notarization credentials and
publishes update metadata through electron-builder. `desktop:release:linux` is
reserved for post-GA Linux preview validation until checksum, provenance,
install, and update policy requirements are promoted. `desktop:release:windows`
expects a Windows code-signing certificate available to electron-builder before
a supported Windows release is cut.

The package step builds the workspace, stages the production server runtime in
`desktop/.desktop-release/server`, stages the built web app in
`desktop/.desktop-release/web`, and writes artifacts to `desktop/release/`.
Both staging and release directories are ignored by git.

## GitHub Workflows

`Desktop Artifacts` runs on desktop/server/web/shared changes and on manual
dispatch. It builds unsigned artifacts on:

- `macos-15`: DMG, ZIP, blockmap, and update YAML.
- `ubuntu-24.04`: x64 AppImage, deb, rpm, blockmap, and update YAML.
- `windows-2025`: x64 NSIS installer, ZIP, blockmap, and update YAML.

Unsigned artifact jobs do not require platform signing credentials.

For v5 GA, the Linux and Windows jobs are preview signals only. They keep
packaging paths and artifact names exercised, but they are not supported release
deliverables and must not be linked from stable release notes as install
targets.

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

Windows releases need a separate code-signing certificate before the first
supported Windows artifact is published. Use `WINDOWS_CSC_LINK` and
`WINDOWS_CSC_KEY_PASSWORD` as the repository secret names when the Windows
release job is enabled. Linux AppImage/deb/rpm artifacts remain preview-only
until checksum verification, GitHub release provenance, platform install smoke,
and update policy requirements are promoted into the supported release path.

## Desktop Support Boundary

| Platform | v5 GA stance                  | Validation matrix                               | Artifact formats             | Update stance                                      |
| -------- | ----------------------------- | ----------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| macOS    | Supported desktop GA target   | macOS 14+ Apple Silicon                         | signed DMG, ZIP              | Supported through signed electron-updater metadata |
| Linux    | Preview only; not a GA target | Ubuntu 24.04 x64 and Fedora 40+ x64 smoke hosts | unsigned AppImage, deb, rpm  | Deferred until Linux release policy is promoted    |
| Windows  | Preview only; not a GA target | Windows 11 23H2+ x64 smoke host                 | unsigned NSIS installer, ZIP | Blocked until Windows code signing and smoke pass  |

Linux and Windows support is post-GA. Do not mention Linux/Windows as v5 GA
install targets until the corresponding release artifact has passed the smoke
matrix below and the compatibility policy has been updated to promote the
platform.

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

The full v5 channel, staged rollout, version-skew, stale-client, and rollback
policy is tracked in
[v5 Compatibility And Release Policy](V5-COMPATIBILITY-AND-RELEASE-POLICY.md).

## Release Checklist

- Bump all workspace package versions together.
- Update `CHANGELOG.md`.
- Run `pnpm typecheck`, `pnpm lint:budget`, `pnpm build`, and
  `pnpm test:unit`.
- Run `pnpm desktop:package:mac:unsigned` and inspect artifact names.
- Run `pnpm desktop:package:linux:unsigned` on Linux or the
  `Desktop Artifacts` Linux job and inspect preview artifact names. This is not
  a v5 GA release gate.
- Run `pnpm desktop:package:windows:unsigned` on Windows or the
  `Desktop Artifacts` Windows job and inspect preview artifact names. This is
  not a v5 GA release gate.
- Run `Desktop Artifacts` and download the uploaded DMG/ZIP/update metadata.
- Run `Desktop Release` only after Apple signing secrets are configured.
- Confirm notarization succeeds and the DMG installs without Gatekeeper
  warnings on a clean Mac.
- Confirm a first run creates the profile/workspace app data directories.
- Confirm update check, download, install, failed-download, and rollback paths
  on the selected channel.
- Confirm `pnpm validate:release` passes and verifies root/shared/server/web,
  CLI, MCP, and desktop package versions plus required v5 release docs.

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

Linux preview unsigned artifact:

These steps generate post-GA readiness evidence only. They are not v5 GA
install instructions.

1. Download `veritas-kanban-linux-unsigned` from the workflow run.
2. On Ubuntu 24.04 x64, install the deb with
   `sudo apt install ./Veritas\ Kanban-*-linux-x64.deb` and launch from the
   app menu.
3. On Fedora 40+ x64, install the rpm with
   `sudo dnf install ./Veritas\ Kanban-*-linux-x64.rpm` and launch from the
   app menu.
4. Run the AppImage with `chmod +x` followed by
   `./Veritas\ Kanban-*-linux-x64.AppImage`.
5. Confirm local server health through the desktop UI, logs, backup/import
   paths, and app data under `~/.config/@veritas-kanban/desktop/`.
6. Confirm uninstall removes the app but preserves user data unless the user
   explicitly deletes the app data directory.

Windows preview unsigned artifact:

These steps generate post-GA readiness evidence only. They are not v5 GA
install instructions.

1. Download `veritas-kanban-windows-unsigned` from the workflow run.
2. On Windows 11 23H2+ x64, run the NSIS installer and accept expected unsigned
   publisher warnings only for PR artifacts.
3. Launch from the Start menu and confirm the desktop status page reaches the
   local app.
4. Confirm the local server binds to loopback, Windows Firewall prompts are
   documented if shown, and app data appears under
   `%APPDATA%\@veritas-kanban\desktop\`.
5. Confirm backup/import, logs, and uninstall behavior. Uninstall should remove
   the app and preserve user data unless explicitly deleted by the user.
6. For supported release artifacts, confirm the installer is code-signed before
   enabling update checks or recommending the artifact to users.

Rollback:

1. Quit Veritas Kanban.
2. Install the previous signed DMG.
3. Launch and confirm the existing profile/workspace data is preserved.
4. If an update artifact is bad, remove or supersede the affected GitHub
   release assets and publish corrected update metadata.

## Platform Notes

Linux and Windows packages are intentionally not v5 GA blockers. The post-GA
artifact jobs keep artifact naming and update-channel conventions portable, but
Windows release and update support stay blocked until code signing and
signed-installer smoke coverage are in place. Linux release and updater support
are deferred until the project has clear checksum, provenance, install, and
AppImage/deb/rpm update policies.
