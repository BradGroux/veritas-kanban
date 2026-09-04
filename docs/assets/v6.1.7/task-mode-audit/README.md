# v6.1.7 task workspace mode audit

These screenshots complete the per-mode visual evidence required by #1385. They were captured on September 4, 2026 from the retained signed v6.1.7 packaged candidate produced by [run 33926469724](https://github.com/BradGroux/veritas-kanban/actions/runs/33926469724), not a Vite server or browser fixture.

- Build commit: `ed5094c6a5f9dd6958ceb952d8d018a40135bf33`
- Packaged app SHA-256: `a23df6443940aff4d9b5013b97ab753b986a63f3bb15dc0d3a8c6aaace866f94`
- Bundle identity: `io.digitalmeld.veritas-kanban`, version 6.1.7
- Host: macOS 15.7.9 arm64
- Window: 1180×900 native window, dark theme
- Capture: macOS window capture at Retina scale, proportionally downsampled to 1292×1012 without cropping or content edits

The same task remained mounted while switching Overview, Plan, Run, Results, and History, then expanding the workspace. Active mode and task context persisted across the presentation change. Every image was decoded and visually inspected for clipping, overflow, blank regions, navigation state, title hierarchy, surface consistency, and visible controls. The exact published hashes are recorded in [manifest.json](manifest.json).

| Mode     | Drawer                      | Expanded                      |
| -------- | --------------------------- | ----------------------------- |
| Overview | [view](drawer-overview.png) | [view](expanded-overview.png) |
| Plan     | [view](drawer-plan.png)     | [view](expanded-plan.png)     |
| Run      | [view](drawer-run.png)      | [view](expanded-run.png)      |
| Results  | [view](drawer-results.png)  | [view](expanded-results.png)  |
| History  | [view](drawer-history.png)  | [view](expanded-history.png)  |

This gallery proves the packaged-candidate task presentation. It does not replace the final Homebrew-installed app launch required by #1383 and #1389.
