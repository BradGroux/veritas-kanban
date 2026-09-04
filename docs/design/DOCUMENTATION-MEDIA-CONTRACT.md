# Documentation media capture contract

Release media must show the candidate that will ship. Keep historical version directories unchanged, write maintained captures under `docs/assets/v<version>/`, and update maintained README and documentation references, including index metadata. Historical release notes retain their original links.

## Capture inventory

`scripts/docs-media/verify.mjs` owns the 14 maintained filenames. Every filename needs an explicit `keep`, `replace`, or `retire` decision and a reason. Both `keep` and `replace` require a current capture; `keep` is not permission to relabel old bytes. Retirement removes maintained references and cannot retire the required Board-to-workspace or mobile-flow interaction GIFs.

Desktop media comes from the actual packaged macOS application. Mobile media uses the supported 390×844 browser viewport. Do not inject a desktop bridge and call a browser screenshot native evidence. GIFs must record the named interaction in progress and visibly complete it; a slideshow made from still screenshots does not qualify.

Use deterministic public-safe data. Inspect cropping, padding, focus, labels, active/hover state, theme accuracy, readable scale, and each GIF's playback. Check that maintained visuals contain no retired bottom chat dock, duplicate header controls, Advanced settings badges, or superseded task/template UI.

## Evidence schema

The original external JSON capture manifest has schema `documentation-media-capture/v1`, status `captured`, `mode: "capture"`, and `dirty: false`. That status means capture finished, not that visual acceptance passed. It records the exact build `commit`, `version`, whole-app `packageDigest`, ISO `completedAt`, and `assets` array. Keep it unchanged beside the original captured files, outside public documentation.

A separate `documentation-media-publication/v1` manifest records the later `publicationCommit`, verification time, and original capture manifest filename and SHA-256. The publication verifier checks the clean checkout, build ancestry, permitted documentation-only changes, original captured files, committed media blobs, and current files. It does not rewrite capture identity or run the interactions again.

Each asset records `name`, `decision`, and `reason`. Non-retired entries additionally record their exact versioned `path`, SHA-256 `sha256`, and `capture` object. The capture object repeats the candidate `commit`, `version`, and `packageDigest`; records `boundary` (`packaged-macos` or `mobile-browser`), `width`, `height`, `scaleFactor`, ISO `capturedAt`, and `method` (`window-capture` or `interaction-recording`). Desktop entries require `packaged: true`. Retired entries must omit path, digest, and capture claims.

Full release validation takes `--media-evidence <publication-manifest>` alongside the native report and exact `.app`. It derives publication HEAD and package digest independently, checks the Git delta from the capture build, verifies every recorded file hash, rejects symlinked media paths, and scans tracked maintained README/docs text for superseded or retired references. The native report must still match the original captured build and whole-app digest; only a verified documentation-only delta may separate that build from publication HEAD. Missing inventory, incomplete or duplicate decisions, changed source, changed identity, changed bytes, and browser-simulated native evidence fail closed. Skipping build-output checks does not skip this gate.

This verifier checks freshness and declared provenance, not image decoding, visual quality, or semantic playback. Those acceptance checks require inspection of the actual media. A manifest is not a substitute for a real capture runner or native conformance evidence. Capture and publication must preserve exact candidate identity; committing source changes requires a new build and new capture evidence, never rewritten identity fields on an older run.

## Capture once, verify for publication

First complete the application/version changes and build the clean candidate. Run `pnpm docs:capture-media /absolute/path/veritas-kanban.app /absolute/path/new-external-directory` on macOS with `ffmpeg` and the pinned Playwright Chromium browser installed. The shared native session launcher verifies the real packaged app, build identity, version, and isolated profile, then authenticates through the production UI. Public-safe tasks are created through that isolated server's authenticated API. Desktop capture uses the actual native window; mobile capture has no injected desktop bridge. Capture waits for fonts and settled overlays for stills, uses reduced motion, and suppresses only the blinking text caret, not focus rings or application layout.

Interaction capture samples before input, while actions and assertions are pending, and after verified completion. Each recording retains numbered raw frames, hashes, timestamps, and named action start/completion frame ranges. Both GIFs and the demo MP4 are encoded from those live frames. Failed input, capture, or encoding leaves diagnostic output and exits nonzero; it cannot emit successful final evidence. The command refuses to overwrite an existing output directory.

Inspect the captured stills and play both GIFs and the demo MP4 through their complete interactions. Copy those exact reviewed bytes into the versioned media paths and both maintained demo-video paths, update guide references, and commit only documentation/media changes. Keep the original capture directory and manifest unchanged. Do not recapture just to obtain bytes with the later documentation commit's identity: real animation timing need not produce byte-identical recordings.

From the clean documentation commit, run `pnpm docs:verify-media /absolute/path/capture/evidence.json /absolute/path/veritas-kanban.app /absolute/path/capture/publication.json`. The new publication manifest must stay beside its original capture manifest and files. Verification checks that each published asset and both demo-video copies match the original captured bytes, including Git's committed blobs; ignored or uncommitted files cannot stand in for published media. Supply `publication.json` to full release validation. This command performs no new captures and refuses to overwrite an existing publication manifest.

Permitted post-build changes are regular, non-executable README/documentation Markdown, `docs/index.json`, the demo player at `docs/demo/index.html`, the 14 versioned maintained media files, and the two demo MP4 paths. Source, dependency, build, version, executable, or other changes require a new clean build and fresh captures. A documentation-only commit cannot justify rewriting an older manifest, changing recorded bytes, or reusing a different app package. Historical preparation/recapture reports remain diagnostic and cannot be promoted to publication evidence by editing their mode or identity.
