# Run budget persistence

Native Settings acceptance found a successful PATCH returning the entered fan-out limit, followed by a GET with the limit missing. Configuration normalization recursively copied only keys present in defaults. The default limits object is empty, so every configured enforcement limit was lost; optional policy fields such as downgradeModel and notes were also discarded.

Normalization now restores the run-budget policy through the existing strict schema after default merging. It preserves approved optional fields without broadening the generic merger's allowlist or bypassing prototype-pollution checks. Invalid limits fail closed instead of becoming an apparently valid policy without enforcement bounds.

The new regression failed five of six cases before the fix. All six pass afterward, including fresh file and SQLite readers, all nine limit fields, zero limits, fractional cost, optional policy fields, default filling, invalid limits, unknown keys, and prototype-pollution rejection. Together with the existing ConfigService tests, 32 tests pass. Server typecheck and changed-file lint pass. Independent standards and specification reviews found no blockers.

Packaged native save/reload acceptance remains pending. The fix prevents future loss; it cannot recover limits already erased from persisted settings. Operators must inspect and re-enter affected default run budgets after upgrading. No installed application or user settings were modified during testing.
