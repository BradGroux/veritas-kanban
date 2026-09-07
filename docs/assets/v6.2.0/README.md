# 6.2.0 candidate media provenance

These are reviewed local-candidate captures, not evidence of a published or signed release.

- Build: `a2e95a42f74c7137ace785c165c0cf7816678a99`; version: 6.2.0; bundle: `io.digitalmeld.veritas-kanban`.
- Whole-app SHA-256: `25d1a2d79a65811aff25f1a90d6a56b8482c6f830c050ac4a54b211adc13a63b`; macOS 26.6.2, Apple silicon, unsigned review package.
- Capture completed: 2026-09-07T22:55:56.032Z. Dark theme, reduced motion, isolated public-safe tasks. Native captures use the real package; mobile captures have no desktop bridge.
- Original JSON capture manifest: `media-620-final-3/evidence.json`, SHA-256 `cba9cb564f72660c9c05d979305ded62f7bf3a4d150a35c4cb1a9c6eb8a056c7`. The original files, recording frames and manifest are retained outside public documentation under the [capture contract](../../design/DOCUMENTATION-MEDIA-CONTRACT.md).
- All 23 PNGs were individually inspected. The two new GIFs and retained baseline GIFs were played through complete cycles, and the MP4 reached its end without a playback error. Desktop and mobile recordings preserve the original input sequence: board, open task in Plan, select Plan, switch to Overview, close to board. Native captures omit the system cursor; visible focus rings remain. No synthetic cursor was added.

Desktop maintained captures use 1700×760 content dimensions; mobile browser views use 390×844. Task-mode views use an actual 1180×900 native window and measured content dimensions. The original task-mode audit includes a frame/shadow and uses a different blocked showcase task with failed history; this candidate uses a To Do documentation task with no run. The older maintained captures used macOS 15.7.9. The 5,000-task comparison uses the same synthetic generator and 1360×900 content dimensions on the current host. The original maintained board has a collapsed left rail; the candidate shows the current expanded default. These differences are disclosed in the [gallery](../../releases/v6.2.0-comparison.md).

| Asset                                                    | Capture boundary | Content dimensions | SHA-256                                                            |
| -------------------------------------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------ |
| [agent-providers.png](agent-providers.png)               | packaged-macos   | 1700×760           | `738dcb078ed9d04f392bdc61d388b677138412834261ecc07dce92352cb78990` |
| [board-overview.png](board-overview.png)                 | packaged-macos   | 1700×760           | `04fdd6a0bd465ab6d05c60c51b3bed4deab1bbb10c4cbf5ce325c39ae9f1b338` |
| [board-to-workspace.gif](board-to-workspace.gif)         | packaged-macos   | 1700×760           | `6541fcde7471fa19d9d590069621bdfe1de9e95d1a360672d81c80ee61f3f76e` |
| [command-palette.png](command-palette.png)               | packaged-macos   | 1700×760           | `113d39646c7a5b802db3efbcb8590df3b5e611850b541b43d8d398ec87b29660` |
| [maintenance-center.png](maintenance-center.png)         | packaged-macos   | 1700×760           | `66ab35e9fd84d90eb4739be552882ca910bb0f9716e235cd600a9a9517431e9d` |
| [mobile-board.png](mobile-board.png)                     | mobile-browser   | 390×844            | `2f7be6ede22fc17da4d771e3e251ba620f126ee2f6b6f0cfc1b058b3e02fa7f0` |
| [mobile-flow.gif](mobile-flow.gif)                       | mobile-browser   | 390×844            | `270017e341f9b03d1467b597391c5c1df0e40a0efbf3403f016608eb644ee163` |
| [mobile-settings.png](mobile-settings.png)               | mobile-browser   | 390×844            | `bb670a6ee3035beb37f8b143b1aabff81d5a51a2ba5767181383b842e7f26ccf` |
| [mobile-task-workspace.png](mobile-task-workspace.png)   | mobile-browser   | 390×844            | `7a55723b0ab0915c32d1e852d80a3dbe8c77026ef64336c947d019fcf2015b08` |
| [notification-adapters.png](notification-adapters.png)   | packaged-macos   | 1700×760           | `ff0ce568a5f7701a7ca63c0a0a54c1f61886f03443777e3bd17590f39793ae71` |
| [settings-navigation.png](settings-navigation.png)       | packaged-macos   | 1700×760           | `956f19175f390ed6b47f824d1e1e50988e486883898526e7ee5cd86a2f25b0e2` |
| [squad-chat.png](squad-chat.png)                         | packaged-macos   | 1700×760           | `314cfc4cb06d27f7eada1e4002856e8bd3788554f884f754f3b4b10300c555dd` |
| [task-workspace.png](task-workspace.png)                 | packaged-macos   | 1700×760           | `022d92c0c1ef907fff22cb44a3c812c4ac54b5e2dfc99a3be4e73f43b3df9a32` |
| [workbench-panel.png](workbench-panel.png)               | packaged-macos   | 1700×760           | `b6f3de6615368e970d531e2666d324e94f8a1d1946fa633a6deb505d7c182334` |
| [task-drawer-overview.png](task-drawer-overview.png)     | packaged-macos   | 1180×900           | `c3792f8911f7313658421f75145729180148f771b47cfb63c646eda62f2df243` |
| [task-drawer-plan.png](task-drawer-plan.png)             | packaged-macos   | 1180×900           | `3879c43f95e90cfb40a3f56ef99478b15d2f25e0901f00c1a9092c4d0d967a4c` |
| [task-drawer-run.png](task-drawer-run.png)               | packaged-macos   | 1180×900           | `d939dd622acd94bc061899d1f2c8119836aa360d104ebe4cd12bf1d53eba491d` |
| [task-drawer-results.png](task-drawer-results.png)       | packaged-macos   | 1180×900           | `adfb2ed99bda4c5bdc36d585888e469770194d3de9b115b936b384b2b9d44027` |
| [task-drawer-history.png](task-drawer-history.png)       | packaged-macos   | 1180×900           | `82d66b1a8054a3e7cf625103b720790eb9e5309df34bc2b36a80d5bff3dbb181` |
| [task-expanded-overview.png](task-expanded-overview.png) | packaged-macos   | 1180×900           | `01af1d92ede27141fa4025cf7e40809e8198b691a9b8a0dd51e240f5faad4c92` |
| [task-expanded-plan.png](task-expanded-plan.png)         | packaged-macos   | 1180×900           | `0583ae2332857c7236fbe2ab6abf34a4f180462b419c639ee2f349eb1e0fc40d` |
| [task-expanded-run.png](task-expanded-run.png)           | packaged-macos   | 1180×900           | `6a11e485bcb416d3a22ee61b847d79c5bda59608474f61de9cad3c280688d662` |
| [task-expanded-results.png](task-expanded-results.png)   | packaged-macos   | 1180×900           | `e560f15b6e563ceebad24076ba872628e07c20ff6117d0781ead931c692c58cb` |
| [task-expanded-history.png](task-expanded-history.png)   | packaged-macos   | 1180×900           | `fd1158b0c472e48abf9da904f46777279b3d24abfadca37c3b41f6b2b02a60da` |
| [board-5000.png](board-5000.png)                         | packaged-macos   | 1360×900           | `db7576b05c278e112472598f4f0ed75e2b84a52b68f60b11d827a733436c2aed` |
