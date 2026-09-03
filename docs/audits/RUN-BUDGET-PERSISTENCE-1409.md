# Run budget persistence

Native Settings acceptance found a successful PATCH returning the entered fan-out limit, followed by a GET with the limit missing. Configuration normalization recursively copied only keys present in defaults. The default limits object is empty, so every configured enforcement limit was lost; optional policy fields such as downgradeModel and notes were also discarded.

Normalization now restores the run-budget policy through the existing strict schema after default merging. It preserves approved optional fields without broadening the generic merger's allowlist or bypassing prototype-pollution checks. Invalid limits fail closed instead of becoming an apparently valid policy without enforcement bounds.

The new regression failed five of six cases before the fix. All six pass afterward, including fresh file and SQLite readers, all nine limit fields, zero limits, fractional cost, optional policy fields, default filling, invalid limits, unknown keys, and prototype-pollution rejection. Together with the existing ConfigService tests, 32 tests pass. Server typecheck and changed-file lint pass. Independent standards and specification reviews found no blockers.

Packaged macOS save/reload acceptance passed in light and dark themes at 1180x760 with 20px text. Fan-out values 100 and 99 survived blur, persistence, full page reload, and reopening Settings. Numeric and select controls measured the same 280px width. Both native captures were visually inspected. Candidate source is `4760687ad9c27827cd83b62cbd1bea9b9136d5e6`; packaged `server/dist/services/config-service.js` SHA-256 is `4824f500437a5b273dfc664d91c70661dc3a7dca747544f0f03018bb7d3f7c6b`. The candidate includes the independently reviewed Settings alignment fix #1405.

The fix prevents future loss; it cannot recover limits already erased from persisted settings. Operators must inspect and re-enter affected default run budgets after upgrading. No installed application or user settings were modified during testing. Native evidence: [light](evidence/budget-1409/budget-light.png), [dark](evidence/budget-1409/budget-dark.png), and [readback record](evidence/budget-1409/native-budget.json).
