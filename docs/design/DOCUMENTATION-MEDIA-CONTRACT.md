# Documentation media capture contract

Release media must show the candidate that will ship. Keep historical version directories unchanged, write maintained captures under `docs/assets/v<version>/`, and update maintained README and documentation references, including index metadata. Historical release notes retain their original links.

## Capture inventory

`scripts/docs-media/verify.mjs` owns the 14 maintained filenames. Every filename needs an explicit `keep`, `replace`, or `retire` decision and a reason. Both `keep` and `replace` require a current capture; `keep` is not permission to relabel old bytes. Retirement removes maintained references and cannot retire the required Board-to-workspace or mobile-flow interaction GIFs.

Desktop media comes from the actual packaged macOS application. Mobile media uses the supported 390×844 browser viewport. Do not inject a desktop bridge and call a browser screenshot native evidence. GIFs must record the named interaction in progress and visibly complete it; a slideshow made from still screenshots does not qualify.

Use deterministic public-safe data. Inspect cropping, padding, focus, labels, active/hover state, theme accuracy, readable scale, and each GIF's playback. Check that maintained visuals contain no retired bottom chat dock, duplicate header controls, Advanced settings badges, or superseded task/template UI.

## Evidence schema

The external JSON capture manifest has schema `documentation-media-capture/v1` and status `captured`. That status means capture finished, not that visual acceptance passed. Final evidence additionally requires `mode: "verify"`, `dirty: false`, and `committedBytesMatch: true`. It records the exact `commit`, `version`, whole-app `packageDigest`, ISO `completedAt`, and `assets` array. Store raw run evidence outside public documentation.

Each asset records `name`, `decision`, and `reason`. Non-retired entries additionally record their exact versioned `path`, SHA-256 `sha256`, and `capture` object. The capture object repeats the candidate `commit`, `version`, and `packageDigest`; records `boundary` (`packaged-macos` or `mobile-browser`), `width`, `height`, `scaleFactor`, ISO `capturedAt`, and `method` (`window-capture` or `interaction-recording`). Desktop entries require `packaged: true`. Retired entries must omit path, digest, and capture claims.

Full release validation takes `--media-evidence <manifest>` alongside the native report and exact `.app`. It derives HEAD and package digest independently, verifies every recorded file hash, rejects symlinked media paths, and scans tracked maintained README/docs text for superseded or retired references. Missing inventory, incomplete or duplicate decisions, changed identity, changed bytes, and browser-simulated native evidence fail closed. Skipping build-output checks does not skip this gate.

This verifier checks freshness and declared provenance, not image decoding, visual quality, or semantic playback. Those acceptance checks require inspection of the actual media. A manifest is not a substitute for a real capture runner or native conformance evidence. Capture and publication must preserve exact candidate identity; committing source changes requires a new build and new capture evidence, never rewritten identity fields on an older run.

## Candidate preparation and final capture

Run `pnpm docs:capture-media /absolute/path/veritas-kanban.app /absolute/path/new-external-directory prepare` on macOS with `ffmpeg` and the pinned Playwright Chromium browser installed. The shared native session launcher verifies the real packaged app, build identity, version, and isolated profile, then authenticates through the production UI. Public-safe tasks are created through that isolated server's authenticated API. Desktop capture uses the actual native window; mobile capture has no injected desktop bridge. Capture waits for fonts and settled overlays for stills, uses reduced motion, and suppresses only the blinking text caret, not focus rings or application layout.

Interaction capture samples before input, while actions and assertions are pending, and after verified completion. Each recording retains numbered raw frames, hashes, timestamps, and named action start/completion frame ranges. Both GIFs and the demo MP4 are encoded from those live frames. Failed input, capture, or encoding leaves diagnostic output and exits nonzero; it cannot emit successful final evidence. The command refuses to overwrite an existing output directory.

Use two passes to avoid a capture/commit identity cycle. First prepare the versioned media and guide references, review them, and commit them. This preparation pass is not release evidence. Then build the final clean commit and run the actual native/mobile interactions again, capturing fresh media into an external run directory. Compare every new file's bytes with its committed versioned asset before emitting the final manifest. The manifest binds the final run's commit and actual package digest, not the preparation build.

If a fresh final capture differs, investigate the change, update the maintained asset if appropriate, commit it, and repeat the final build/capture. Deterministic fixtures and capture timing must make this reproducible; the final run must not copy the committed files and call that a capture. Keep capture timestamps and raw evidence external so producing the manifest does not dirty the candidate. A producer that cannot reproduce the reviewed assets must fail rather than weaken candidate binding. Visual inspection and GIF playback apply to those final captured bytes.
