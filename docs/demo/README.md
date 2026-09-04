# Demo Video Hosting

The public demo video is hosted by GitHub Pages from this repository's `main` branch and `/docs` source. New captures encode the Board-to-workspace interaction's live frames into both GIF and MP4; they do not assemble a slideshow from existing screenshots. Historical media remains unchanged until reviewed replacements are committed.

- Public player page: `https://bradgroux.github.io/veritas-kanban/demo/`
- Video asset: `docs/assets/demo-overview.mp4`
- Source copy: `assets/demo-overview.mp4`

To update the public demo video and maintained screenshot/GIF set:

1. Build the macOS candidate with `VERITAS_BUILD_SHA` equal to the checkout's HEAD. Install the pinned Playwright Chromium test browser with `pnpm exec playwright install chromium` and have `ffmpeg` on `PATH`.
2. Run `pnpm docs:capture-media /absolute/path/veritas-kanban.app /absolute/path/new-capture-directory prepare`. The directory must not exist and must be outside the checkout. The command launches an isolated authenticated packaged server, captures desktop and 390×844 mobile views, and writes the media, raw interaction frames, and diagnostic evidence there. It never replaces the installed app or copies media into the repository automatically.
3. Inspect every still and play both GIFs and `demo-overview.mp4`. Reject clipped controls, incomplete interactions, private content, or stale UI. A completed preparation run is not release acceptance.
4. Install accepted stills/GIFs under `docs/assets/v<version>/`; copy the accepted MP4 to both `assets/demo-overview.mp4` and `docs/assets/demo-overview.mp4`. Verify those copies are identical, update maintained guide references and player metadata, and verify `docs/demo/index.html` plays the video locally before committing.
5. Rebuild the clean final commit and run the capture command with a new external directory and `verify` instead of `prepare`. This mode rejects a dirty checkout and fails if fresh captures differ from the committed assets. Follow the [media contract](../design/DOCUMENTATION-MEDIA-CONTRACT.md); never relabel preparation evidence as final evidence.
6. Merge only after the release gates and visual acceptance pass. GitHub Pages publishes the updated player from `/docs`.
