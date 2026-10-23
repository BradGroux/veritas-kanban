# Veritas Kanban Desktop Release

> The 6.3.0 release uses local verification, signing, and retained package/media evidence. GitHub Actions and third-party CI must remain disabled. Publishing the release follows the reviewed local promotion path; installed-app replacement remains a separate decision.

This guide covers desktop packaging paths for macOS GA artifacts and
Linux/Windows preview artifact scaffolding: unsigned PR artifacts, signed
release artifacts, update metadata, and smoke testing.

For v6 GA, macOS is the only supported desktop release target. Linux and
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
pnpm desktop:smoke:mac:local
```

`desktop:package:mac:dir` creates an unpacked local app for fast inspection.
`desktop:package:mac:unsigned` creates unsigned DMG/ZIP artifacts and update
metadata for PR validation. `desktop:package:linux:unsigned` creates preview
x64 AppImage, deb, and rpm artifacts. `desktop:package:windows:unsigned`
creates preview x64 NSIS installer and ZIP artifacts.

`desktop:release:mac` expects Apple signing and notarization credentials and stages artifacts with publishing disabled. It does not upload a release or collect the full native/media evidence. Use the local capture command below for a retained release candidate. `desktop:release:linux` is
reserved for post-GA Linux preview validation until checksum, provenance,
install, and update policy requirements are promoted. `desktop:release:windows`
expects a Windows code-signing certificate available to electron-builder before
a supported Windows release is cut.

The package step builds the workspace, stages the production server runtime in
`desktop/.desktop-release/server`, stages the built web app in
`desktop/.desktop-release/web`, and writes artifacts to `desktop/release/`.
Both staging and release directories are ignored by git.

`pnpm desktop:smoke:mac:local` runs the macOS directory packaging path and then
asserts that root dev tooling such as Prettier, ESLint, and the desktop
`electron-builder` dependency still exist. Use it after package-script changes
that touch production staging or pnpm deploy behavior. The staging deploy runs
from an isolated temporary workspace so `pnpm deploy --prod` cannot rewrite the
live repository install into a production-only dependency state.

## Local signed capture and retention

Use a clean, reviewed checkout of the final build commit. All seven workspace package versions must match the requested version. The output must be a new directory outside that checkout, with an existing parent. Earlier generated files in `desktop/release` or `desktop/.desktop-release` stop preflight; preserve those files and use a fresh checkout instead of overwriting a retained build.

The capture host requires macOS 14 or later on Apple Silicon, the pinned pnpm version, Node 22.22.1 or later, Xcode command-line tools, ffmpeg, and the repository's installed Playwright Chromium binary. The existing native display contract requires a logical display of at least 1920×1080. Provision these prerequisites explicitly; capture does not install system tools, change display settings, or download browser binaries.

Supply exactly one signing mode through the launching environment: `CSC_NAME` for an existing valid Developer ID Application identity in the login Keychain, or `CSC_LINK` and `CSC_KEY_PASSWORD` for the existing certificate-import path. For `CSC_NAME`, use its certificate fingerprint or matching name without the `Developer ID Application:` prefix; preflight requires exactly one valid match. Supply exactly one notarization group: an existing `APPLE_KEYCHAIN_PROFILE`, or `APPLE_API_KEY` (an existing absolute `.p8` file), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`, or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Existing Keychain identities and profiles are reused without exporting a private key or creating new credential storage. Do not put credentials in command arguments, source, retained evidence, or release notes. Signing credentials are passed only to the packaging and notarization subprocesses. The local path does not decode or store a new private key.

```bash
pnpm desktop:release:mac:local preflight --version 6.3.0 --channel stable --output /absolute/path/new-candidate
pnpm desktop:release:mac:local capture --version 6.3.0 --channel stable --output /absolute/path/new-candidate
```

Preflight reports missing requirements without launching the app. Capture installs the frozen lockfile, runs source preflight, builds, signs and notarizes the existing DMG/ZIP distribution, and extracts the retained ZIP for signature and Gatekeeper checks. It then runs the existing 144-state native matrix and six fault probes, verifies native evidence, checks the large-board performance scenarios, and captures original documentation media from that exact app. It never publishes a release or invokes GitHub workflows.

Before any app launch, capture durably saves the exact existing `veritas` protocol handler in `protocol-before.json`. A missing or unavailable original handler stops capture. After success or a handled failure, it restores and reads back that exact application path before removing its own extracted app. A handler changed to a third application is preserved and stops restoration for explicit operator recovery.

Successful output includes the five signed distribution/update files, their checksum list, native screenshots and evidence, large-board evidence, original documentation captures, protocol backup/readback, and `local-release-candidate.json`. Save the printed manifest SHA-256 independently for promotion. The local provenance schema records the source commit/tree, version, channel, Node version, original package digest, and exact retained-file inventory; it does not claim a hosted workflow run. A seal verifies retained bytes, not independent acceptance of the app or media.

Failures preserve the output directory and `capture-state.json`, including the last phase and extracted app path when one exists. No successful candidate seal is issued for a failed capture. Do not reuse or delete failed output until it has been inspected. If the process is forcibly interrupted or protocol restoration fails, compare the current handler with the backup and the recorded candidate path before recovery:

```bash
swift scripts/native-ui/protocol-handler.swift inspect
# After checking protocol-before.json, explicitly restore its exact applicationPath:
swift scripts/native-ui/protocol-handler.swift restore /absolute/path/original.app
swift scripts/native-ui/protocol-handler.swift inspect
```

If a third application now owns the scheme, preserve that choice and resolve it explicitly. After verifying recovery, remove only the extracted temporary directory recorded for this capture if it is no longer needed. Keep the distribution and evidence packet for diagnosis.

Local promotion is tracked in [#1710](https://github.com/BradGroux/veritas-kanban/issues/1710). It must reuse the retained distribution and original captures, verify the independently saved seal, recheck native/signing/media evidence, and allow only the existing documentation/media changes between build and publication commits. Capture success alone does not authorize skipping those checks or publishing assets manually.

## Retained GitHub workflow definitions

The repository retains historical `Desktop Artifacts` and `Desktop Release` definitions. They are not the execution path for this release. Do not enable, dispatch, label for execution, rerun, or require them; all required verification runs locally. The historical hosted candidate schema remains separate from local provenance.

Full local release validation now requires explicit candidate paths:

```bash
pnpm validate:release -- --native-evidence /absolute/path/evidence.json --native-app /absolute/path/veritas-kanban.app --media-evidence /absolute/path/capture/publication.json
```

For source and published-body checks before a candidate exists, use `--source-only --skip-build-output` (plus `--github` when checking the published body). Its success message is explicitly source preflight, never release acceptance. `--skip-build-output` alone does not bypass native or media evidence. Source-only mode rejects candidate evidence arguments instead of silently ignoring them.

Browser verification, packaged candidate verification, installed-app verification, signing/notarization, documentation-media review, and publication are separate results. Report the exact boundary and evidence for each; pending or blocked work remains pending or blocked. The [documentation media contract](design/DOCUMENTATION-MEDIA-CONTRACT.md) requires original capture provenance, file hashes, committed-byte checks, and a maintained-reference scan. This proves freshness, not visual quality or GIF semantics. Actual playback and visual inspection remain required. The capture job records media once from the extracted distribution app and retains it even on failure. The promotion job uses `scripts/docs-media/publish.mjs` to verify those same files and refuses app-source changes, altered capture records, and changed published bytes. Follow the [capture and publication workflow](demo/README.md); do not promote old preparation output or still-image montages.

## Homebrew Cask

The supported packaged install path is the dedicated BradGroux tap:

```bash
brew tap BradGroux/tap
brew install --cask veritas-kanban
```

The cask lives in
`BradGroux/homebrew-tap/Casks/veritas-kanban.rb` and tracks the signed,
notarized GitHub release ZIP. After publishing a stable macOS release, update
the cask version and SHA256, then validate from the registered tap checkout:

```bash
brew style --cask bradgroux/tap/veritas-kanban
brew audit --cask --strict --online bradgroux/tap/veritas-kanban
brew install --cask --dry-run bradgroux/tap/veritas-kanban
brew livecheck bradgroux/tap/veritas-kanban
```

## Required Release Secrets

The historical hosted mapping below documents existing secret names. Local capture instead uses the environment names described above; do not enable a workflow to supply them.

- `MACOS_CSC_LINK`: base64 encoded `.p12` Developer ID Application certificate
  or a secure URL accepted by electron-builder `CSC_LINK`.
- `MACOS_CSC_KEY_PASSWORD`: password for the `.p12` signing identity.

Then configure exactly one complete notarization credential set. The workflow
fails before packaging if neither set is complete, if either set is partial, or
if both sets are configured at the same time.

### Preferred: App Store Connect API-key notarization

- `APPLE_API_KEY_BASE64`: base64 encoded App Store Connect API `.p8` key.
- `APPLE_API_KEY_ID`: App Store Connect API key ID.
- `APPLE_API_ISSUER`: App Store Connect API issuer UUID.

The workflow decodes `APPLE_API_KEY_BASE64` into a temporary private-key file
and maps it to electron-builder/notarytool as `APPLE_API_KEY`. The key file is
created under the runner temp directory and is not written to the repository.

### Fallback: Apple ID app-specific-password notarization

- `APPLE_ID`: Apple developer account email address.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The workflow maps those values to electron-builder/notarytool only when the API
key credential set is absent. Do not configure both notarization modes in the
same repository environment; that is treated as a release-preflight error so CI
cannot silently use the wrong credential path.

Windows releases need a separate code-signing certificate before the first
supported Windows artifact is published. Use `WINDOWS_CSC_LINK` and
`WINDOWS_CSC_KEY_PASSWORD` as the repository secret names when the Windows
release job is enabled. Linux AppImage/deb/rpm artifacts remain preview-only
until checksum verification, GitHub release provenance, platform install smoke,
and update policy requirements are promoted into the supported release path.

## Desktop Support Boundary

| Platform | v6 GA stance                  | Validation matrix                               | Artifact formats             | Update stance                                      |
| -------- | ----------------------------- | ----------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| macOS    | Supported desktop GA target   | macOS 14+ Apple Silicon                         | signed DMG, ZIP              | Supported through signed electron-updater metadata |
| Linux    | Preview only; not a GA target | Ubuntu 24.04 x64 and Fedora 40+ x64 smoke hosts | unsigned AppImage, deb, rpm  | Deferred until Linux release policy is promoted    |
| Windows  | Preview only; not a GA target | Windows 11 23H2+ x64 smoke host                 | unsigned NSIS installer, ZIP | Blocked until Windows code signing and smoke pass  |

Linux and Windows support is post-GA. Do not mention Linux/Windows as v6 GA
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

The full v6 channel, staged rollout, version-skew, stale-client, and rollback
policy is tracked in
[v6 Compatibility And Release Policy](V6-COMPATIBILITY-AND-RELEASE-POLICY.md).

## Release Checklist

- Bump all workspace package versions together.
- Update `CHANGELOG.md`.
- Run `pnpm typecheck`, `pnpm lint:budget`, `pnpm build`, and
  `pnpm test:unit`.
- Confirm `pnpm desktop:check:electron-artifacts` passes. The emitted main and
  preload bundles must import Electron's runtime API and must not contain the
  npm install/download shim.
- Run `pnpm desktop:smoke:mac:local` to verify local packaging does not prune
  root dev tooling.
- Run `pnpm desktop:test:readiness` and confirm the bounded readiness helper
  rejects a stale version and reports a useful timeout.
- Run `pnpm desktop:package:mac:unsigned` and inspect artifact names.
- Run `pnpm desktop:package:linux:unsigned` on Linux or the
  `Desktop Artifacts` Linux job and inspect preview artifact names. This is not
  a v6 GA release gate.
- Run `pnpm desktop:package:windows:unsigned` on Windows or the
  `Desktop Artifacts` Windows job and inspect preview artifact names. This is
  not a v6 GA release gate.
- Apply `ci:full` to the release-candidate pull request, then download the
  uploaded DMG/ZIP/update metadata from its `Desktop Artifacts` run.
- Edit `docs/releases/vX.Y.Z.md`, run
  `pnpm validate:release -- --version X.Y.Z --native-evidence /absolute/path/evidence.json --native-app /absolute/path/veritas-kanban.app --media-evidence /absolute/path/capture/publication.json`, and publish that exact file with
  `gh release create --notes-file` or `gh release edit --notes-file`. Do not
  hand-author or repair the live body separately.
- Use one logical source line per prose paragraph and let GitHub wrap it to the
  available width. Keep release structure to level-two headings. Prefer one
  cohesive full-width paragraph for a handful of related changes. Use Markdown
  lists only when every item is concise enough to avoid multi-line hanging
  indentation; the format gate caps list items at 160 source characters. Never
  stack bold-led paragraphs or long labeled list items that look like accidental
  carriage returns.
- Run `Desktop Release` only after Developer ID signing secrets and exactly one
  complete notarization credential set are configured.
- Inspect the rendered release on both the releases index and tag page. Confirm
  prose uses natural page-width wrapping, lists remain compact, and no ragged
  hanging-indent block, unmarked paragraph stack, or sentence-sized fragment was
  introduced.
- Confirm notarization succeeds with the intended credential mode and the DMG
  installs without Gatekeeper warnings on a clean Mac.
- Confirm a first run creates the profile/workspace app data directories.
- Confirm startup/auth/setup surfaces are draggable while their controls remain
  clickable, and a populated isolated SQLite profile offers **Use Existing
  Data** with representative counts before password setup.
- Confirm the
  [Web To Mac Desktop Migration](WEB-TO-MAC-DESKTOP-MIGRATION.md) decision tree
  matches the shipped onboarding labels and Maintenance import behavior.
- Confirm update check, download, install, failed-download, and rollback paths
  on the selected channel.
- For a Homebrew upgrade, confirm `open -a` followed by
  `pnpm desktop:wait:ready -- --expected-version <version>` tolerates normal
  startup delay and proves the packaged server owns `3001`.
- Confirm full `pnpm validate:release` passes with `--native-evidence`, `--native-app`, and `--media-evidence`, verifying candidate-bound macOS evidence, documentation-media freshness, root/shared/server/web/CLI/MCP/desktop package versions, and required v6 release docs. A source-only preflight is not this gate.

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

These steps generate post-GA readiness evidence only. They are not v6 GA
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

These steps generate post-GA readiness evidence only. They are not v6 GA
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

Linux and Windows packages are intentionally not v6 GA blockers. The post-GA
artifact jobs keep artifact naming and update-channel conventions portable, but
Windows release and update support stay blocked until code signing and
signed-installer smoke coverage are in place. Linux release and updater support
are deferred until the project has clear checksum, provenance, install, and
AppImage/deb/rpm update policies.

### Native menu verification

The packaged native UI gate exercises New Task, Settings, Search, Command Center,
Import, Export, Create Backup, and Create Debug Bundle through Electron's installed
menu and the mounted renderer. File data commands and Debug Bundle open the existing
Maintenance flow; they do not automatically export, restore, or create files.
Renderer commands wait for an acknowledgement. Finish setup and unlock the workspace
before using them; unavailable actions display a reason instead of reporting success.

On macOS, Command-W closes the window while the managed server stays running.
Reopen the window from the Dock. Command-Q quits and stops the managed server.
Standard Hide, Hide Others, Show All and Services commands are available in the
application menu; View provides text zoom and full screen.

Saved window bounds are fitted to the current display work areas at launch or
reopen. If a monitor was disconnected, the window returns to the primary display.
Maximized windows retain their previous normal bounds for unmaximizing.

The custom header follows the macOS title-bar double-click preference (zoom/fill,
minimize, or no action). Configure it in [Desktop & Dock settings](https://support.apple.com/guide/mac-help/change-desktop-dock-settings-mchlp1119/mac).
The native gate records the current preference and verifies its action without
changing the operator's system preferences.

### Settings window ownership

On macOS, Settings and Command-comma focus one reusable, modeless native window. The main board remains usable. Browser clients and other desktop platforms retain the shared modal presentation. Settings links and native Import, Export, Backup, and Debug Bundle commands select the corresponding shared section after the authenticated renderer acknowledges the request.

The native window uses the existing isolated, sandboxed preload with Node integration disabled. Bridge calls and command receipts are restricted to owned top-level renderers at the current application origin; generated startup status pages are a separate main-window-only case. Settings navigation stays in the settings surface, and external links use the existing validated OS opener.

Closing Settings hides its renderer and restores focus to the board, retaining pending edits and failed writes for retry. Reopening restores that session. Quit waits for its serialized settings writes before stopping the local server. A failed or stalled save keeps the app open and directs the user back to Settings. Normal native close, minimize, restore, and focus controls apply to this window independently of the board's saved bounds.

The two windows share the existing browser profile. Appearance uses the existing local preference store. Settings/configuration changes send same-origin invalidation notices, without values or credentials, and each renderer refetches through its authenticated API. Sign-in changes refresh each window's auth guard; workspace selection follows the shared profile. Hidden Settings continues to receive updates and remains subject to the same server permissions.
