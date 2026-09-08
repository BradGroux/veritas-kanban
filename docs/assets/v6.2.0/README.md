# 6.2.0 signed media provenance

These reviewed captures come from the signed and notarized distribution candidate. Release upload and destination readback are recorded separately in the [release evidence packet](../../V6-RC-EVIDENCE-PACKET.md).

- Build: `0b5d65754735716edfd8ebe8ecb93633b70bfbc7`; version: 6.2.0; bundle: `io.digitalmeld.veritas-kanban`.
- Whole-app SHA-256: `fab61cf2514475b2d872d8f041735ba3fe59bee54d80a6dcb9ccabe27de69fba`; macOS 15.7.9, Apple silicon, extracted from the signed distribution ZIP.
- [Signed capture run](https://github.com/BradGroux/veritas-kanban/actions/runs/34181935829) retained the original distribution, native and large-board evidence, and documentation media. Signature and Gatekeeper checks passed on the extracted app.
- Capture completed: 2026-09-08T03:16:39.694Z. Dark theme, reduced motion, isolated public-safe tasks. Native captures use the actual distribution app; mobile captures use a 390×844 browser without a desktop bridge.
- Original capture manifest: `signed-620-run34181935829/retained-macos-candidate/documentation-media/evidence.json`, SHA-256 `5e39dacf39fdc8cbef11d05c01fd8e05da6b6f0251b224f62d94b9bd34964891`. Original frames and files are retained unchanged under the [capture contract](../../design/DOCUMENTATION-MEDIA-CONTRACT.md).
- All 23 PNGs were individually inspected; both GIFs were played through complete cycles and the MP4 reached its end without a playback error. The retained baseline GIFs were also reviewed. Native captures omit the system cursor; visible focus rings remain, with no synthetic cursor.

Desktop maintained captures use 1700×760 content dimensions; mobile browser views use 390×844. Task-mode captures use an actual 1180×900 native window and measured content dimensions. The original task-mode audit includes a frame/shadow and uses a different blocked showcase task with failed history; the candidate uses a To Do documentation task with no run. The baseline maintained captures used macOS 15.7.9; the signed candidate used macOS 15.7.9. The baseline 5,000-task image was captured on the local macOS 26.6.2 host, while the signed candidate image came from the signing runner. Both use the same synthetic generator and 1360×900 content dimensions; hardware and host conditions differ, so the pair is not a performance benchmark. The baseline maintained board has a collapsed rail; the candidate shows its expanded default. These differences are disclosed in the [gallery](../../releases/v6.2.0-comparison.md).

| Asset                                                    | Capture boundary | Content dimensions | SHA-256                                                            |
| -------------------------------------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------ |
| [agent-providers.png](agent-providers.png)               | packaged-macos   | 1700×760           | `86f855eccc9a6295a77421e90ed13a3ee30b8fec09d1b575446ac5ef23a4ddf0` |
| [board-overview.png](board-overview.png)                 | packaged-macos   | 1700×760           | `d2afe7d50426e7fe630b2a77e748f0ba36608f6383536bd18f4fd48e48a51892` |
| [board-to-workspace.gif](board-to-workspace.gif)         | packaged-macos   | 1700×760           | `f8ec67b35d16d3f89784be8dd9716e82f147d613856e0e764b51367e27f0cac7` |
| [command-palette.png](command-palette.png)               | packaged-macos   | 1700×760           | `11bbc247d260a7a3a1c342126a83c90a88ec41f88ea4a20e7698de85247a9e2c` |
| [maintenance-center.png](maintenance-center.png)         | packaged-macos   | 1700×760           | `e4767366297f3df085513d71217a1b63af42680c82d45316ca1543d44f7d62a5` |
| [mobile-board.png](mobile-board.png)                     | mobile-browser   | 390×844            | `916b0018c04f6e46fb1868e6aad93c522e21c507d3dd71066617b18f55c85dc9` |
| [mobile-flow.gif](mobile-flow.gif)                       | mobile-browser   | 390×844            | `4122d4d737598b08da2054b6d23afdcbe1295d8f40d67bdb6a4baff27a67cded` |
| [mobile-settings.png](mobile-settings.png)               | mobile-browser   | 390×844            | `6600cf869b0cf6807ce8bcf6dfa156249d5b791fbc199dc9e5ff50fb50a7438b` |
| [mobile-task-workspace.png](mobile-task-workspace.png)   | mobile-browser   | 390×844            | `ca7b6a26143a6ed51a749571bf9b0298270b997876ccab96568e4c8bba1040e4` |
| [notification-adapters.png](notification-adapters.png)   | packaged-macos   | 1700×760           | `a645c2df2eac479c0e9e463b102ba7928a4090a7d565a058515ca93546e018e4` |
| [settings-navigation.png](settings-navigation.png)       | packaged-macos   | 1700×760           | `c72334db0fe71f57777aa306bd64c19f5502bd39bb394e975f8b7985dd4dff65` |
| [squad-chat.png](squad-chat.png)                         | packaged-macos   | 1700×760           | `8040c086dc8405fc4d2b9f2642833cae71c728812935632859bfeb0077f07a77` |
| [task-workspace.png](task-workspace.png)                 | packaged-macos   | 1700×760           | `4b0ce1b9b68b118f329125227686f1fcedb7c7a818ca6ea90039bbaecb27926a` |
| [workbench-panel.png](workbench-panel.png)               | packaged-macos   | 1700×760           | `3c505dac2cdc6d8f45a5ac7aadd1a0a684ad6c0dfe6879dcd69043b1fc31c79f` |
| [task-drawer-overview.png](task-drawer-overview.png)     | packaged-macos   | 1180×900           | `8f7a91716f6ae6ce357de6356963e079560e24479fbb85e276c48bcd5458ef26` |
| [task-drawer-plan.png](task-drawer-plan.png)             | packaged-macos   | 1180×900           | `3832ea90c490960dff76dd2d02566a954da478a9eb93830d0e5e4e2190c59aeb` |
| [task-drawer-run.png](task-drawer-run.png)               | packaged-macos   | 1180×900           | `070b6f3dae9f46823ac83b5236e6da70b53b5b89e185d28935ead1966ddaa159` |
| [task-drawer-results.png](task-drawer-results.png)       | packaged-macos   | 1180×900           | `bf35067ffc3c9a83fbfe5f487bf4523379180b64b5ce3baa3a4b167c353f1be7` |
| [task-drawer-history.png](task-drawer-history.png)       | packaged-macos   | 1180×900           | `0de39821066e1c75eea7728fb746bf2f02d5bb7e488ff841bf998c93a2589bfb` |
| [task-expanded-overview.png](task-expanded-overview.png) | packaged-macos   | 1180×900           | `90bdcbae12552d0b59965364e870b370b4124c74473919290f4e2c5f790eec40` |
| [task-expanded-plan.png](task-expanded-plan.png)         | packaged-macos   | 1180×900           | `a96b4f5fb5add4b964bc8dcab43719d8a0eaabf282f43979e187ab232b585292` |
| [task-expanded-run.png](task-expanded-run.png)           | packaged-macos   | 1180×900           | `5ebf795b9205a263f1059dad641a7eabf95a6019d38d5c4c27c7a9167625cc96` |
| [task-expanded-results.png](task-expanded-results.png)   | packaged-macos   | 1180×900           | `2af152fb1d7615699b78ad72f4b62d3fa8e81fbcb2154360b64fd5fe249c2d4c` |
| [task-expanded-history.png](task-expanded-history.png)   | packaged-macos   | 1180×900           | `b096988469cf01b54fb9da8fafdf60b46d634daddf5cd9a926fdaffe03e5b24b` |
| [board-5000.png](board-5000.png)                         | packaged-macos   | 1360×900           | `5e4f6e3c8af51c42416cadbcd2b321f519d781625e6a60db81e2633f0ceef92a` |
