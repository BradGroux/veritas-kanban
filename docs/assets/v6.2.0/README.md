# 6.2.0 candidate media provenance

These are reviewed local-candidate captures, not evidence of a published or signed release.

- Build: `a2b8fbba0e2851d65611238624d8c9de347a2a27`; version: 6.2.0; bundle: `io.digitalmeld.veritas-kanban`.
- Whole-app SHA-256: `476a61cbc81f2a78b76657a87ccc98e2be645d2886d78e5df5fe51d7424dedcb`; macOS 26.6.2, Apple silicon, unsigned review package.
- Capture completed: 2026-09-08T00:35:55.632Z. Dark theme, reduced motion, isolated public-safe tasks. Native captures use the real package; mobile captures have no desktop bridge.
- Original JSON capture manifest: `media-public-620-4/evidence.json`, SHA-256 `bb92f226413b403639f0b6dcc5bbe9ef415fc1a4ea3302904bbd7f435de6d90d`. The original files, recording frames and manifest are retained outside public documentation under the [capture contract](../../design/DOCUMENTATION-MEDIA-CONTRACT.md).
- All 23 PNGs were individually inspected. The two new GIFs and retained baseline GIFs were played through complete cycles, and the MP4 reached its end without a playback error. Desktop and mobile recordings preserve the original input sequence: board, open task in Plan, select Plan, switch to Overview, close to board. Native captures omit the system cursor; visible focus rings remain. No synthetic cursor was added.

Desktop maintained captures use 1700×760 content dimensions; mobile browser views use 390×844. Task-mode views use an actual 1180×900 native window and measured content dimensions. The original task-mode audit includes a frame/shadow and uses a different blocked showcase task with failed history; this candidate uses a To Do documentation task with no run. The older maintained captures used macOS 15.7.9. The 5,000-task comparison uses the same synthetic generator and 1360×900 content dimensions on the current host. The original maintained board has a collapsed left rail; the candidate shows the current expanded default. These differences are disclosed in the [gallery](../../releases/v6.2.0-comparison.md).

| Asset                                                    | Capture boundary | Content dimensions | SHA-256                                                            |
| -------------------------------------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------ |
| [agent-providers.png](agent-providers.png)               | packaged-macos   | 1700×760           | `738dcb078ed9d04f392bdc61d388b677138412834261ecc07dce92352cb78990` |
| [board-overview.png](board-overview.png)                 | packaged-macos   | 1700×760           | `04fdd6a0bd465ab6d05c60c51b3bed4deab1bbb10c4cbf5ce325c39ae9f1b338` |
| [board-to-workspace.gif](board-to-workspace.gif)         | packaged-macos   | 1700×760           | `ce440813e19cb05ea211407811622e75b7f835f3994a255990a5e815b1902bdc` |
| [command-palette.png](command-palette.png)               | packaged-macos   | 1700×760           | `db25eeca42d00a7b8056c99df58ea34822914f355833a0ac7db6debaedf5a700` |
| [maintenance-center.png](maintenance-center.png)         | packaged-macos   | 1700×760           | `b9a97426d7677917283d71c1055f2b87bb270770561beb0ce11c37e7065d65a7` |
| [mobile-board.png](mobile-board.png)                     | mobile-browser   | 390×844            | `2f7be6ede22fc17da4d771e3e251ba620f126ee2f6b6f0cfc1b058b3e02fa7f0` |
| [mobile-flow.gif](mobile-flow.gif)                       | mobile-browser   | 390×844            | `270017e341f9b03d1467b597391c5c1df0e40a0efbf3403f016608eb644ee163` |
| [mobile-settings.png](mobile-settings.png)               | mobile-browser   | 390×844            | `bb670a6ee3035beb37f8b143b1aabff81d5a51a2ba5767181383b842e7f26ccf` |
| [mobile-task-workspace.png](mobile-task-workspace.png)   | mobile-browser   | 390×844            | `7a55723b0ab0915c32d1e852d80a3dbe8c77026ef64336c947d019fcf2015b08` |
| [notification-adapters.png](notification-adapters.png)   | packaged-macos   | 1700×760           | `ff0ce568a5f7701a7ca63c0a0a54c1f61886f03443777e3bd17590f39793ae71` |
| [settings-navigation.png](settings-navigation.png)       | packaged-macos   | 1700×760           | `37061022142096d82227e692063687e157b62005fb622306e4b949bea351124f` |
| [squad-chat.png](squad-chat.png)                         | packaged-macos   | 1700×760           | `06aa4e29fd285a2cab281a211843cd3ec1afd1561446f8903642d4c4bf1d91fe` |
| [task-workspace.png](task-workspace.png)                 | packaged-macos   | 1700×760           | `022d92c0c1ef907fff22cb44a3c812c4ac54b5e2dfc99a3be4e73f43b3df9a32` |
| [workbench-panel.png](workbench-panel.png)               | packaged-macos   | 1700×760           | `b6f3de6615368e970d531e2666d324e94f8a1d1946fa633a6deb505d7c182334` |
| [task-drawer-overview.png](task-drawer-overview.png)     | packaged-macos   | 1180×900           | `c3792f8911f7313658421f75145729180148f771b47cfb63c646eda62f2df243` |
| [task-drawer-plan.png](task-drawer-plan.png)             | packaged-macos   | 1180×900           | `3879c43f95e90cfb40a3f56ef99478b15d2f25e0901f00c1a9092c4d0d967a4c` |
| [task-drawer-run.png](task-drawer-run.png)               | packaged-macos   | 1180×900           | `0eb3e06c6f8b0427e51ba76018028c1598dbd84efec54a48b413c1fb86948563` |
| [task-drawer-results.png](task-drawer-results.png)       | packaged-macos   | 1180×900           | `adfb2ed99bda4c5bdc36d585888e469770194d3de9b115b936b384b2b9d44027` |
| [task-drawer-history.png](task-drawer-history.png)       | packaged-macos   | 1180×900           | `ee445e7f5024928bce46451af5fc5cd86ab6e860cea7ee6cd8474139bb351169` |
| [task-expanded-overview.png](task-expanded-overview.png) | packaged-macos   | 1180×900           | `faa98937bc33c7bd6581934e234b68b0b193e008ee29f801ad3cbc43656f4b22` |
| [task-expanded-plan.png](task-expanded-plan.png)         | packaged-macos   | 1180×900           | `0583ae2332857c7236fbe2ab6abf34a4f180462b419c639ee2f349eb1e0fc40d` |
| [task-expanded-run.png](task-expanded-run.png)           | packaged-macos   | 1180×900           | `1d2722305131bddb02c0c3a735714aac659149cdab525e1250548b7df2b2767f` |
| [task-expanded-results.png](task-expanded-results.png)   | packaged-macos   | 1180×900           | `e560f15b6e563ceebad24076ba872628e07c20ff6117d0781ead931c692c58cb` |
| [task-expanded-history.png](task-expanded-history.png)   | packaged-macos   | 1180×900           | `3ab524f5d0953b76c36c6443a9e126fc8fb86ba45d11c5ce5ee82c9bbbbeb8c8` |
| [board-5000.png](board-5000.png)                         | packaged-macos   | 1360×900           | `2f1c3e9c230e5d14e19de61cc5121d5191faee0b7fe85d5a6d3cbfa676b4e3e4` |
