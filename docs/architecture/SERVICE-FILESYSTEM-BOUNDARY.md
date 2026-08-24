# Service Filesystem Boundary

Service modules must use the storage abstraction instead of importing Node's
filesystem APIs directly. The current exceptions are tracked in
[`service-filesystem-boundary.json`](service-filesystem-boundary.json) so the
existing migration debt is explicit without allowing it to spread.

Run the boundary gate with:

```bash
pnpm check:service-filesystem-boundary
```

The gate recursively scans `server/src/services/**/*.ts` and recognizes static
imports, dynamic imports, and `require()` calls for `fs`, `node:fs`, and their
`/promises` variants. Filesystem text embedded in strings and comments is
ignored. The command exits nonzero and names the file when it finds:

- a direct import without a classified inventory entry;
- an invalid category, owner, or rationale;
- a duplicate entry; or
- a stale entry after an import has been removed.

`maximumEntries` must equal the number of classified exceptions. Any increase
therefore requires a visible inventory and ratchet change in the same review.
The remaining #1163 child issues own the reductions: #1187 covers operational
evidence, #1188 managed content, and #1189 final process I/O plus removal of the
last compatibility exceptions. Each migration must delete its stale inventory
entries and lower `maximumEntries` in the same change.
