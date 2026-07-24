# Veritas Kanban v6 Release Candidate Evidence Packet

This packet is the retained evidence target for Veritas Kanban 6.0.0. It
separates merged implementation, deterministic conformance, live provider
evidence, local runtime proof, signed publication, and Homebrew availability.

Documentation freshness: 2026-07-24 for Veritas Kanban 6.0.0.

## Release Scope

| Field                    | Value                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Release version          | 6.0.0                                                                                                              |
| Release tracker          | [Veritas Kanban 6.0.0 harness parity and Buzz integration](https://github.com/BradGroux/veritas-kanban/issues/924) |
| Buzz epic                | [First-class Buzz integration](https://github.com/BradGroux/veritas-kanban/issues/904)                             |
| Harness epic             | [Equal-footing agent harness support](https://github.com/BradGroux/veritas-kanban/issues/915)                      |
| Implementation baseline  | `398fe7f67e94c3d6cabee0702b2331d9c873fd0f`                                                                         |
| Release branch           | `release/v6.0.0`                                                                                                   |
| Release PR               | Pending source publication                                                                                         |
| Release merge            | Pending source publication                                                                                         |
| Tag and GitHub release   | Pending source publication                                                                                         |
| Desktop Release workflow | Pending tag publication                                                                                            |
| Homebrew PR              | Pending signed ZIP publication                                                                                     |
| Evidence host            | macOS 26.5.2 arm64; Node 26.5.0; pnpm 11.1.1; Git 2.55.0                                                           |

## Issue And Pull Request Traceability

### Support, task, launch, credential, and worktree foundations

| Issue                                                                                         | Pull request                                                 | Outcome                                                  |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| [First-class harness support profile](https://github.com/BradGroux/veritas-kanban/issues/919) | [#925](https://github.com/BradGroux/veritas-kanban/pull/925) | One support tier and fail-closed onboarding contract     |
| [Immutable run launch manifest](https://github.com/BradGroux/veritas-kanban/issues/854)       | [#926](https://github.com/BradGroux/veritas-kanban/pull/926) | Attempt-bound compiled launch evidence                   |
| [Provider-owned task transports](https://github.com/BradGroux/veritas-kanban/issues/892)      | [#928](https://github.com/BradGroux/veritas-kanban/pull/928) | Immutable task request rendered per adapter              |
| [Idempotent completion results](https://github.com/BradGroux/veritas-kanban/issues/893)       | [#930](https://github.com/BradGroux/veritas-kanban/pull/930) | One authoritative provider-neutral terminal result       |
| [Credential registry and leases](https://github.com/BradGroux/veritas-kanban/issues/931)      | [#933](https://github.com/BradGroux/veritas-kanban/pull/933) | Value-free definitions and exact run/action leases       |
| [Transactional worktrees](https://github.com/BradGroux/veritas-kanban/issues/858)             | [#934](https://github.com/BradGroux/veritas-kanban/pull/934) | Remote-safe allocation, ownership, recovery, and cleanup |

### Durable shared runtime

| Issue                                                                                      | Pull request                                                                                                               | Outcome                                                    |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Causal run-event journal](https://github.com/BradGroux/veritas-kanban/issues/850)         | [#949](https://github.com/BradGroux/veritas-kanban/pull/949), [#950](https://github.com/BradGroux/veritas-kanban/pull/950) | Replayable redacted events and CI repair                   |
| [Interactive approval broker](https://github.com/BradGroux/veritas-kanban/issues/852)      | [#953](https://github.com/BradGroux/veritas-kanban/pull/953)                                                               | Exact-action durable approvals                             |
| [Durable run supervisor](https://github.com/BradGroux/veritas-kanban/issues/853)           | [#954](https://github.com/BradGroux/veritas-kanban/pull/954)                                                               | Restart ownership, recovery, and terminal reconciliation   |
| [Conversation lifecycle](https://github.com/BradGroux/veritas-kanban/issues/856)           | [#958](https://github.com/BradGroux/veritas-kanban/pull/958)                                                               | Capability-gated resume, follow-up, fork, steer, and close |
| [Run-scoped tool control plane](https://github.com/BradGroux/veritas-kanban/issues/857)    | [#959](https://github.com/BradGroux/veritas-kanban/pull/959)                                                               | Versioned discovery/catalog and governed invocation        |
| [Generic ACP stdio provider](https://github.com/BradGroux/veritas-kanban/issues/870)       | [#961](https://github.com/BradGroux/veritas-kanban/pull/961)                                                               | Provider-neutral ACP v1 client adapter                     |
| [ACP server view](https://github.com/BradGroux/veritas-kanban/issues/960)                  | [#967](https://github.com/BradGroux/veritas-kanban/pull/967)                                                               | `vk acp serve` and status over Veritas-owned sessions      |
| [Launch credential classification](https://github.com/BradGroux/veritas-kanban/issues/932) | [#963](https://github.com/BradGroux/veritas-kanban/pull/963)                                                               | Boot, brokered, and high-risk passthrough evidence         |
| [Credential boundary catalog](https://github.com/BradGroux/veritas-kanban/issues/968)      | [#971](https://github.com/BradGroux/veritas-kanban/pull/971)                                                               | Exact value-free broker boundary                           |
| [Mediated lease consumption](https://github.com/BradGroux/veritas-kanban/issues/969)       | [#972](https://github.com/BradGroux/veritas-kanban/pull/972)                                                               | One-shot downstream MCP credential resolution              |
| [System-owned provider bridge](https://github.com/BradGroux/veritas-kanban/issues/970)     | [#973](https://github.com/BradGroux/veritas-kanban/pull/973)                                                               | Narrow `veritas-run` injection or fail-closed block        |
| [Runtime hook bus](https://github.com/BradGroux/veritas-kanban/issues/874)                 | [#977](https://github.com/BradGroux/veritas-kanban/pull/977)                                                               | Bounded in-process pre/post runtime hooks                  |
| [Harness conformance suites](https://github.com/BradGroux/veritas-kanban/issues/859)       | [#975](https://github.com/BradGroux/veritas-kanban/pull/975)                                                               | Seeded deterministic repeated evaluation                   |

### Harness adapters and Buzz delivery

| Issue                                                                                    | Pull request                                                 | Outcome                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| [Grok Build ACP profile](https://github.com/BradGroux/veritas-kanban/issues/920)         | [#966](https://github.com/BradGroux/veritas-kanban/pull/966) | Exact v0.2.111 restrictive ACP profile                        |
| [Codex app-server v2](https://github.com/BradGroux/veritas-kanban/issues/921)            | [#952](https://github.com/BradGroux/veritas-kanban/pull/952) | Pinned JSON-RPC v2 lifecycle adapter                          |
| [Claude Code stream adapter](https://github.com/BradGroux/veritas-kanban/issues/916)     | [#951](https://github.com/BradGroux/veritas-kanban/pull/951) | Bare-mode supervised stream-json execution                    |
| [GitHub Copilot CLI ACP profile](https://github.com/BradGroux/veritas-kanban/issues/917) | [#965](https://github.com/BradGroux/veritas-kanban/pull/965) | Public-preview exact v1.0.74 restrictive profile              |
| [Buzz compatibility diagnostics](https://github.com/BradGroux/veritas-kanban/issues/905) | [#946](https://github.com/BradGroux/veritas-kanban/pull/946) | Reference-only relay/identity evidence                        |
| [Buzz Squad Chat adapter](https://github.com/BradGroux/veritas-kanban/issues/906)        | [#947](https://github.com/BradGroux/veritas-kanban/pull/947) | Signed bidirectional roots/replies and replay                 |
| [Buzz Agent ACP profile](https://github.com/BradGroux/veritas-kanban/issues/907)         | [#964](https://github.com/BradGroux/veritas-kanban/pull/964) | Exact Buzz v0.4.24 generic ACP profile                        |
| [Buzz run-scoped MCP](https://github.com/BradGroux/veritas-kanban/issues/909)            | [#974](https://github.com/BradGroux/veritas-kanban/pull/974) | System-owned `veritas-run` bridge for Buzz                    |
| [Buzz persona/team import](https://github.com/BradGroux/veritas-kanban/issues/910)       | [#948](https://github.com/BradGroux/veritas-kanban/pull/948) | Signed preview-first one-way import                           |
| [Buzz workflow triggers](https://github.com/BradGroux/veritas-kanban/issues/911)         | [#978](https://github.com/BradGroux/veritas-kanban/pull/978) | Allowlisted root-message triggers with replay protection      |
| [Buzz compatibility gate](https://github.com/BradGroux/veritas-kanban/issues/912)        | [#979](https://github.com/BradGroux/veritas-kanban/pull/979) | Composed 50-test credential-free gate                         |
| [Cross-harness matrix](https://github.com/BradGroux/veritas-kanban/issues/918)           | [#976](https://github.com/BradGroux/veritas-kanban/pull/976) | One matrix for API, doctor, Settings, telemetry, and dispatch |

### Release-blocking native fixes

| Issue                                                                                               | Pull request                                                 | Outcome                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| [Lazy run-supervisor storage binding](https://github.com/BradGroux/veritas-kanban/issues/981)       | [#982](https://github.com/BradGroux/veritas-kanban/pull/982) | Packaged SQLite startup initializes storage before lookup       |
| [Reject desktop updater downgrade metadata](https://github.com/BradGroux/veritas-kanban/issues/983) | [#984](https://github.com/BradGroux/veritas-kanban/pull/984) | v6 refuses published v5 metadata after stable channel selection |

### Release engineering

| Issue                                                                                       | Pull request                                                 | Outcome                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| [Tier changed-file and full CI](https://github.com/BradGroux/veritas-kanban/issues/955)     | [#957](https://github.com/BradGroux/veritas-kanban/pull/957) | Focused pull-request gates with explicit full-workspace lanes  |
| [Bounded desktop upgrade readiness](https://github.com/BradGroux/veritas-kanban/issues/927) | [#929](https://github.com/BradGroux/veritas-kanban/pull/929) | Version-matched installed-app startup and diagnostic readiness |

## Reviewed Provider Baselines

| Harness            | Version/build                             | Deterministic posture   | Credential-gated posture                           |
| ------------------ | ----------------------------------------- | ----------------------- | -------------------------------------------------- |
| Buzz Agent         | v0.4.24 / `710ed9...`; `buzz-agent 0.1.0` | Pass: 7 files, 50 tests | Binary unavailable; no live claim                  |
| Grok Build         | v0.2.111 / `94172f2aa4e5`                 | Pass in workspace gate  | Installed 0.2.22 is stale and unauthenticated      |
| Codex app-server   | 0.145.0 / `25af12...`                     | Pass in workspace gate  | Pass: exact authenticated 0.145.0, 1 smoke test    |
| Codex SDK          | 0.144.3                                   | Pass in workspace gate  | Deterministic evidence only                        |
| Claude Code        | 2.1.218                                   | Pass in workspace gate  | Binary unavailable; no live claim                  |
| GitHub Copilot CLI | 1.0.74 / `2b809c...` tag commit           | Pass in workspace gate  | Exact binary installed; authentication unavailable |
| Hermes             | v2026.7.7.2                               | Pass in workspace gate  | Binary unavailable; retained non-Certified tier    |
| OpenClaw           | v2026.6.11                                | Pass in workspace gate  | Installed 2026.6.1 is stale; no live gateway claim |

No row may be changed to a live passing claim without exact command/runtime
evidence. A skipped credential gate remains skipped, not passed.

### Observed isolated-runtime support tiers

The packaged 6.0.0 candidate returned these redacted
`harness-compatibility-matrix/v1` support statuses from the copied v5.2.5
profile. Deterministic fixture results do not replace these live tiers.

| Profile                 | Observed tier | Certification | Evidence date | Runtime evidence                                                     |
| ----------------------- | ------------- | ------------- | ------------- | -------------------------------------------------------------------- |
| OpenAI Codex CLI        | Configured    | Not current   | 2026-07-24    | `codex-cli 0.145.0`; executable and authentication detected          |
| OpenAI Codex SDK        | Detected      | Not current   | 2026-07-24    | `codex-cli 0.145.0`; disabled profile                                |
| OpenAI Codex app-server | Detected      | Not current   | 2026-07-24    | `codex-cli 0.145.0`; disabled profile                                |
| GitHub Copilot CLI      | Detected      | Not current   | 2026-07-24    | GitHub Copilot CLI 1.0.74; disabled profile; auth not inferred       |
| Grok Build              | Detected      | Not current   | 2026-07-24    | 0.2.22 build `967574cb117`; disabled and older than reviewed 0.2.111 |
| Claude Code             | Degraded      | Not current   | 2026-07-24    | Executable not installed                                             |
| Buzz Agent              | Degraded      | Not current   | 2026-07-24    | Executable not installed                                             |
| Hermes                  | Degraded      | Not current   | 2026-07-24    | Executable not installed                                             |
| OpenClaw                | Detected      | Not current   | 2026-07-24    | 2026.6.1 executable found; no enabled profile or live gateway claim  |

No profile reported Certified because persisted certification evidence was
not current in this isolated profile. OpenClaw is Detected at the host boundary
because the executable exists while no profile is enabled; its stale
2026.6.1 build is not a live gateway claim. The exact authenticated app-server
smoke remains separate command evidence, not a support-tier mutation.

## Verification Matrix

Results are filled from the clean release candidate. Counts and elapsed time are
recorded when the tool reports them.

| Gate                                                      | Environment                     | Result  | Evidence or limitation                                                            |
| --------------------------------------------------------- | ------------------------------- | ------- | --------------------------------------------------------------------------------- |
| Toolchain versions                                        | macOS 26.5.2 arm64              | Pass    | Node 26.5.0; pnpm 11.1.1; Git 2.55.0                                              |
| `pnpm install --frozen-lockfile`                          | clean release worktree          | Pass    | 1,116 packages in 4.8 s; lockfile pinned to pnpm 11.1.1                           |
| `pnpm check:pnpm-settings`                                | clean release worktree          | Pass    | Package manager and instruction versions agree                                    |
| `pnpm audit --prod --audit-level=high`                    | production dependencies         | Pass    | 0 high/critical; 1 low and 1 moderate retained                                    |
| `pnpm lint` and `pnpm lint:budget`                        | all tracked source/docs         | Pass    | 0 errors; 595 warnings within the 600-warning budget                              |
| `pnpm qa:mantine`                                         | built web bundle                | Pass    | Initial JS 238.9 KiB gzip; CSS 51.4 KiB gzip                                      |
| `pnpm typecheck`                                          | all workspaces                  | Pass    | 11.97 s                                                                           |
| `pnpm build`                                              | all workspaces                  | Pass    | 16.53 s                                                                           |
| `pnpm test:unit`                                          | sequential workspaces           | Pass    | 3,217 passed, 4 skipped; 329 files; 48.74 s                                       |
| `pnpm test:e2e`                                           | Playwright matrix               | Pass    | 36/36; Chromium, mobile Chromium, mobile WebKit; 79.76 s                          |
| `pnpm smoke:cli-mcp`                                      | release output                  | Limited | Static versions/builds pass; live read/write skipped without test key             |
| `pnpm test:buzz:compatibility`                            | credential-free fixtures        | Pass    | 7 files, 50/50 tests; 4.30 s Vitest                                               |
| Provider/lifecycle/approval/MCP/credential suites         | credential-free fixtures        | Pass    | Focused release integration set: 4 files, 83/83 tests, 2.76 s                     |
| `pnpm desktop:test`                                       | macOS arm64                     | Pass    | 14 files, 61 tests, 344 ms                                                        |
| `pnpm desktop:build`                                      | macOS arm64                     | Pass    | 1.20 s; Electron artifact check 4/4                                               |
| `pnpm desktop:check:electron-artifacts`                   | fresh desktop output            | Pass    | Main and preload artifacts accepted                                               |
| `pnpm desktop:smoke:mac:local`                            | isolated unsigned package       | Pass    | 25.28 s                                                                           |
| `pnpm desktop:package:mac:unsigned`                       | macOS arm64                     | Pass    | Final post-blocker DMG/ZIP package in 57.49 s                                     |
| v5.2.5 populated-profile upgrade                          | isolated copy                   | Pass    | Matching counts, integrity, owner summary, profile; registry absence preserved    |
| v5.2.5 registry compatibility                             | exact-format deterministic test | Pass    | 1/1; identity, provider, capabilities, metadata, status, and session preserved    |
| File-backed migration and restore                         | isolated deterministic fixture  | Pass    | 7/7; tasks, config, workflows, chat, telemetry, backup, and restore               |
| In-app Browser runtime                                    | isolated server/web             | Pass    | First run, login, provider/Buzz settings, themes, palette/focus; 0 console errors |
| Local browser automation                                  | Playwright matrix               | Pass    | 36-route/interaction E2E matrix                                                   |
| Native desktop runtime                                    | isolated profile                | Pass    | One instance, window, health, menus, reopen, update, clean quit                   |
| `pnpm validate:release -- --version 6.0.0`                | clean release worktree          | Pass    | 0.60 s                                                                            |
| `pnpm validate:release -- --version 6.0.0 --docker-build` | production target               | Pass    | 116.39 s; `veritas-kanban:validate-6.0.0`                                         |
| Focused standards review                                  | diff from `398fe7f6...`         | Pass    | GPT-5.6 standards axis; no remaining findings; cross-model review waived          |
| Focused spec/security claim review                        | release tracker and goal prompt | Pass    | GPT-5.6 spec axis; findings corrected; secret/security scan passed                |

### Accepted browser verification split

On 2026-07-24 the maintainer directed a sustainable verification cadence:
focused behavior tests for issue pull requests, changed-file CI per pull
request, and one complete workspace suite at the final release gate. Applying
that direction, the in-app Browser pass covered rendered and interactive
behavior that benefits from manual inspection: first run, login, provider and
Buzz Settings, degraded states, dark/light themes, command-palette focus,
labels, and console health. Stateful task launch, causal events, approvals,
cancellation, Buzz replay, MCP, worktrees, telemetry, completion, compact
layout, and recoverable errors remained in the passing deterministic and E2E
automation instead of being duplicated manually in the in-app Browser.

This is an explicit release-evidence split, not a claim that those scripted
flows were manually clicked in the in-app Browser.

## Migration And Data Preservation

Completed isolated drill:

- source: latest signed v5.2.5 desktop workspace copy under an isolated
  `codex-v525-smoke` profile;
- no database writer before copy or after final quit;
- `PRAGMA quick_check=ok` before and after;
- matching counts before and after: 2 tasks, 3 Squad Chat messages,
  1 telemetry event, 1 workflow definition, 1 workflow run,
  1 app-config document, and 1 user;
- agent registry absent before and after; no implicit provider enablement or
  OpenClaw fallback;
- a separate automated fixture using the exact v5.2.5 registry shape preserved
  agent identity, provider, capabilities, metadata, status, and session
  reference in 1/1 focused test;
- the file-backed portability suite passed 7/7 for tasks, configuration,
  workflows, chats, telemetry, backup, failure recovery, and restore;
- onboarding detected and summarized the populated database, v6 health
  reported 6.0.0, the packaged renderer opened, provider and Buzz settings
  rendered, reopen/single-instance/menu/update/quit checks passed;
- the final updater check reported 5.2.5 as older with downgrade disallowed,
  and download/install actions remained disabled;
- rollback remains restore-first: retain the stopped-writer v5.2.5 backup
  because destructive schema down-migration is not promised.

The signed profile contained no agent registry, so the native drill proves that
absence remains absence while the exact-format automated fixture covers a
populated v5 registry. The signed fixture's two task rows were deliberately
minimal direct-SQL migration records, so the onboarding count is authoritative
evidence; their incomplete legacy JSON is not claimed as a rendered task-card
test.

No private data, credential value, raw provider conversation, or unrestricted
runtime profile is retained in this packet.

## Publication Evidence

Source publication values are intentionally pending until the release PR
merges and the annotated tag exists. Signed distribution values are
intentionally pending until the tag-triggered workflow completes.

| Publication item                                | Result                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Release merge SHA                               | Pending                                                                      |
| Annotated `v6.0.0` tag object and peeled commit | Pending                                                                      |
| GitHub release URL                              | Pending                                                                      |
| Desktop Release workflow URL and duration       | Pending                                                                      |
| Signed/notarized DMG                            | Pending name, bytes, SHA-256, GitHub digest, signature, Gatekeeper, stapling |
| Signed/notarized ZIP                            | Pending name, bytes, SHA-256, GitHub digest, signature, Gatekeeper, stapling |
| DMG/ZIP blockmaps and SHA-256 sidecars          | Pending                                                                      |
| `latest-mac.yml`                                | Pending version, names, sizes, SHA-512 matches                               |
| Downloaded signed-app isolated launch           | Pending                                                                      |
| Homebrew tap issue/PR/merge                     | Pending                                                                      |
| Homebrew style/audit/dry-run/livecheck          | Pending                                                                      |

The final values are added through a focused post-publication documentation PR.
Source CI, tag creation, asset upload, signing, notarization, downloaded runtime,
and Homebrew availability are independent gates.

## Deferred v6.x Work And Accepted Limits

- [Run-scoped egress gateway](https://github.com/BradGroux/veritas-kanban/issues/855)
  is deferred for fine-grained HTTP method/path/domain enforcement. Required
  rules unsupported by current provider evidence already block launch.
- Grok Build and GitHub Copilot CLI retain documented source-provenance limits.
- GitHub Copilot CLI ACP remains public preview.
- Buzz Agent does not resume in-memory sessions; Buzz communication does not
  project files, reactions, forums, DMs, or destructive edit/delete behavior.
- Linux and Windows desktop packages remain unsigned previews.
- Provider and Buzz Settings screenshots were captured from the isolated
  profile. No public-safe active approval existed, so approval visual evidence
  remains a documented text contract.
