# Demo Video Hosting

The public demo video is hosted by GitHub Pages from this repository's `main` branch and `/docs` source. It is rebuilt from the same public-safe 6.1.5 screenshots used by the maintained visual tour.

- Public player page: `https://bradgroux.github.io/veritas-kanban/demo/`
- Video asset: `docs/assets/demo-overview.mp4`
- Source copy: `assets/demo-overview.mp4`

To update the public demo video and maintained screenshot/GIF set:

1. Run `pnpm docs:capture-media` from a clean checkout with `ffmpeg` on `PATH`.
2. Review every file in `docs/assets/v6.1.5/` for private or stale content.
3. Verify `assets/demo-overview.mp4` and `docs/assets/demo-overview.mp4` are identical.
4. Verify `docs/demo/index.html` plays the video locally.
5. Merge to `main`; GitHub Pages publishes the updated player from `/docs`.
