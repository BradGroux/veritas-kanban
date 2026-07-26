# Knowledge Collections v1

`knowledge-collection/v1` is the workspace-scoped foundation for source-grounded project knowledge. It separates immutable source evidence from the derived pages, ingestion proposals, and query answers that will consume that evidence.

## Collection contract

Every collection stores:

- a stable operation-derived ID inside one authenticated workspace;
- a versioned `knowledge-collection-definition/v1` schema covering page kinds, required metadata, stable naming, bidirectional links, review-required ingestion, and bounded page history;
- an access policy with explicit read and write roles, a maximum source classification, and an export posture; and
- content digests, actor attribution, timestamps, and a caller operation ID stored only as a digest.

Administrators always retain read and write access. Every configured writer must also be a reader. The creator must have write access under the new policy, preventing a non-admin caller from creating a collection it cannot subsequently maintain.

Creating a collection is idempotent for the same operation and exact request. Reusing that operation identity with changed input, or creating the same slug through another operation in the workspace, returns conflict.

## Immutable source catalog

`knowledge-source/v1` supports two storage modes:

- `content-addressed-blob` stores a bounded UTF-8 snapshot whose SHA-256 digest and byte count are computed by the server.
- `content-addressed-reference` records an externally retained source by caller-supplied SHA-256 digest and byte count without copying the content.

A source key identifies the logical source. Each new registration creates the next immutable revision and points to the source revision it supersedes. A retry with the same operation and exact request returns the original revision; changed input under the same operation fails closed.

Inline blobs are verified before persistence and whenever file-backed content is read. The file repository rejects malformed base64, digest mismatches, unsafe store paths, oversized stores, excessive inventories, and revision races. SQLite applies the same metadata and revision contract inside a transaction.

Source classifications are `public`, `internal`, `confidential`, and `restricted`. Registration cannot exceed the collection policy ceiling. Collection reads and source access require a role listed by the collection, in addition to the route-level `work_product:read` or `work_product:write` permission. Cross-workspace lookup does not reveal whether an object exists.

Agent access is also bound to one persisted run launch manifest. Agent requests send
`x-veritas-task-id`, `x-veritas-attempt-id`, and
`x-veritas-launch-manifest-digest`; partial or malformed evidence is rejected.
The server loads the exact attempt manifest and accepts access only when the
task, attempt, digest, resource enforcement, and blocker state still match.
`knowledge:*` allows the complete knowledge surface. Otherwise, a manifest must
name an exact source ID, source key, source URI, page ID, or page stable key.

## Derived pages and citations

`knowledge-page/v1` stores Markdown-compatible synthesis separately from immutable source evidence. Each page has one canonical stable key, durable aliases, a typed page kind, tags, collection-required metadata, review state, confidence, outgoing page IDs, computed backlinks, and a bounded revision history.

Every material claim carries a stable page-local claim ID and one or more citations to immutable source revision IDs. Citations can include a line range, heading occurrence, JSON pointer, excerpt hash, time range, or an additional excerpt digest. Unknown source revisions fail closed before persistence.

A multi-page update resolves stable keys and aliases against the complete collection. Alias matches revise the existing page and preserve its canonical identity rather than creating a duplicate. Links can target canonical keys, aliases, or page IDs, including other pages in the same batch. The service recomputes all affected backlinks and commits every changed page through one compare-and-set repository batch. File storage uses one locked atomic replacement; SQLite uses one immediate transaction. A stale page digest aborts the whole batch.

Page revisions retain content hashes, claims, links, backlinks, review evidence, actor attribution, request identity, and operation identity. History is capped by the collection's `maxPageVersions` policy. Agents can prepare draft or review-required synthesis, while only administrators can mark a page approved or rejected.

## Reviewed ingestion transactions

`knowledge-ingestion-proposal/v1` is a durable dry run. Creating one resolves the exact source revisions and page candidates but does not mutate the page graph. The proposal records full before and after page snapshots, compare-and-set page digests, page create/revise/backlink changes, index upserts, source selection, extractor-supplied contradictions, stable-claim contradictions, and the activity entry that application will append.

Stable claim keys are compared across revisions. Changed text backed by a different source set produces a warning contradiction automatically. Extractors can add informational, warning, or blocking contradictions. Blocking contradictions cannot be applied; the operator must create a replacement proposal that resolves them.

Only administrators can apply or reverse a proposal. Apply requires the exact dry-run proposal digest and every expected page digest. File mode changes the page graph, proposal state, and append-only activity in one locked atomic file replacement. SQLite performs the same changes in one immediate transaction. A crash or stale page therefore cannot leave pages applied without their proposal and activity evidence.

Apply and reverse transitions are versioned, actor-attributed, timestamped, and bound to the complete immutable preview digest. Exact retries return the already committed state. Reverse requires every affected page to still match the proposal's applied snapshot, restores complete prior page records, removes pages created by the proposal, recomputes graph validity, and appends a separate reversal activity entry. Later edits or new links that make reversal unsafe return conflict without partial mutation.

## Storage and API

The file backend keeps collection metadata, source revisions, derived pages, ingestion proposals, activity, integrity findings, and deduplicated blobs in one lock-protected, atomically replaced `knowledge-collections.json`. SQLite migrations 30 through 33 add unique workspace, slug, source revision, operation, page identity, stable-key, proposal, activity, and integrity-finding constraints. Both implement the same repository interface.

The initial REST surface is mounted at both `/api/v1/knowledge/collections` and `/api/knowledge/collections`:

| Method | Path                                                                             | Purpose                     |
| ------ | -------------------------------------------------------------------------------- | --------------------------- |
| `GET`  | `/knowledge/collections`                                                         | List readable collections   |
| `POST` | `/knowledge/collections`                                                         | Create a collection         |
| `GET`  | `/knowledge/collections/:collectionId`                                           | Read collection metadata    |
| `GET`  | `/knowledge/collections/:collectionId/sources`                                   | List source revisions       |
| `POST` | `/knowledge/collections/:collectionId/sources`                                   | Register a source revision  |
| `GET`  | `/knowledge/collections/:collectionId/sources/:sourceId`                         | Read source metadata        |
| `GET`  | `/knowledge/collections/:collectionId/pages`                                     | List derived pages          |
| `GET`  | `/knowledge/collections/:collectionId/pages/:pageId`                             | Read a derived page         |
| `POST` | `/knowledge/collections/:collectionId/pages/:pageId/claims/:claimId/transitions` | Transition a cited claim    |
| `POST` | `/knowledge/collections/:collectionId/integrity/lint`                            | Run deterministic lint      |
| `GET`  | `/knowledge/collections/:collectionId/integrity/findings`                        | List durable findings       |
| `POST` | `/knowledge/collections/:collectionId/integrity/findings/:findingId/transitions` | Transition a finding        |
| `GET`  | `/knowledge/collections/:collectionId/integrity/health`                          | Read integrity health       |
| `POST` | `/knowledge/collections/:collectionId/search`                                    | Search raw and derived data |
| `POST` | `/knowledge/collections/:collectionId/search/promotions`                         | Promote selected results    |
| `POST` | `/knowledge/collections/:collectionId/exports`                                   | Create a cited work product |
| `GET`  | `/knowledge/collections/:collectionId/ingestion/proposals`                       | List dry runs               |
| `POST` | `/knowledge/collections/:collectionId/ingestion/proposals`                       | Create a dry run            |
| `GET`  | `/knowledge/collections/:collectionId/ingestion/proposals/:proposalId`           | Read a dry run              |
| `POST` | `/knowledge/collections/:collectionId/ingestion/proposals/:proposalId/apply`     | Apply atomically            |
| `POST` | `/knowledge/collections/:collectionId/ingestion/proposals/:proposalId/reverse`   | Reverse atomically          |
| `GET`  | `/knowledge/collections/:collectionId/activity`                                  | List append-only activity   |

The REST API deliberately returns source metadata, not stored source content. Collection-scoped search reads snapshots internally through the repository, distinguishes `raw-source` from `derived-page` results, and returns source IDs and claim locators instead of uncited synthesis. Collection and workspace RBAC apply before any search data is read.

## Cited search

Bounded keyword search spans immutable raw snapshots and current derived pages. Callers can search both layers or restrict the request to one. Raw hits cite their immutable source revision. Derived hits retain the deduplicated claim citations stored on the page, so consumers can distinguish evidence from synthesis and follow each material claim back to its registered source.

For `auto` or `qmd`, current derived page digests produce a Markdown projection under the runtime directory. Each workspace collection and launch-manifest scope receives a hashed QMD collection name inside an isolated `QMD_CONFIG_DIR` and `INDEX_PATH`; the adapter registers it with the documented `collection add --mask "**/*.md"` command, marks it excluded from unscoped QMD queries, refreshes only when projection digests change, and queries it with an exact `-c` filter. QMD paths are accepted only when they map back to an eligible page ID, and citations come from the authoritative page record rather than QMD output. Set `VERITAS_QMD_KNOWLEDGE_EMBED=true` to refresh embeddings for changed projections.

The response follows the existing search degradation contract. QMD-ranked derived hits identify `backend: "qmd"` while raw-source hits identify `backend: "keyword"`. Missing QMD, refresh/query failure, or a raw-only scope returns cited keyword results with `degraded: true` and an explicit reason. Every hit also carries its effective classification. Confidential and restricted snippets are withheld from previews rather than returned to the caller.

## Deterministic integrity lint

`POST /knowledge/collections/:collectionId/integrity/lint` inspects only the
sources and pages readable inside the caller's role and run launch manifest. It
detects broken links, backlink drift, orphan pages, duplicate identities,
invalid page kinds, missing required metadata, uncited claims, inaccessible
sources, changed retained-source hashes, invalid citation locators, stale pages
and sources, repeated terms without canonical pages, and unanswered questions.

Callers can supply an exact `asOf` timestamp and freshness rules for page kinds
or source media types. Findings have stable IDs and digests, contain identifiers
rather than source text, and are deterministically ordered. Repeating an
unchanged request over unchanged inputs returns the same report digest.
Research candidates are opt-in and informational.

Optional semantic candidate checks compare a bounded claim set and flag
low-confidence evidence gaps, same-key disagreements, near-duplicates, and
claims citing different revisions of one logical source. Findings link both
page, claim, and source identities so reviewers can inspect both sides without
copying protected text into the report.

Set `persistFindings: true` with a stable `runId` to synchronize findings into
the file or SQLite repository. Exact retries of one run chunk do not increment
occurrence counts. `pageLimit` is capped at 500 and `pageCursor` resumes the
deterministically ordered page scan; the response returns a continuation with
the next cursor and completion state. Each scheduled-workflow tick therefore
performs bounded work, persists idempotently, and resumes after interruption.

Durable findings retain severity, status, owner, acknowledgement reason, due
date, remediation task or proposal links, first and last observation,
occurrence count, revision, and digest-bound transition history. Status is
`open`, `acknowledged`, `remediating`, or `resolved`; only administrators
resolve a finding. The findings list and integrity-health routes apply the same
launch scope and expose open, acknowledged, remediating, resolved, overdue, and
last-observation counts.

## Claim lifecycle

Every newly created material claim starts `active`. A compare-and-set transition
can move it through `needs-review`, `disputed`, `superseded`, `retracted`, or
back to an earlier state. The caller supplies the expected page digest, expected
claim state, operation identity, reason, and optional retained evidence source
IDs. Each transition records both states, evidence IDs, actor, timestamp,
operation and request digests, and its own digest in a new page revision.

Agents can flag claims only as `needs-review` or `disputed`; an administrator
must finalize supersession, retraction, or resolution. Exact retries are
idempotent, changed reuse of an operation identity fails, stale page or state
evidence fails compare-and-set, and page history makes the transition
reversible. A disputed claim remains visible with all citations and transition
evidence; the transition never deletes or silently replaces either side.

## Query promotion

Search responses carry an evidence digest over the exact query, bounded result array, and launch context. A caller can select one or more result IDs and propose new or revised pages without converting the answer directly into durable truth. Promotion validates the unchanged evidence digest and run binding, collection membership of raw sources, current identity and exact citations of derived pages, and the selected source set before creating a standard ingestion dry run.

The proposal persists the query, evidence digest, and sorted selected result IDs. Its candidate pages, source IDs, contradictions, review, atomic apply, reversal, attribution, and idempotency all use the same transaction contract as source ingestion. Promotion never adds a second mutation path.

## Cited work-product export

A validated search selection can also create a Markdown work product. The render preserves each selected result's raw-versus-derived kind, backend, score, redacted snippet, and exact source citations. Relative source links point back to immutable source metadata or the cited derived page. Work-product metadata retains the collection, query, evidence digest, export policy, selected-result count, and citation count so later Markdown or JSON export does not sever provenance.

The collection export policy is enforced twice. `forbidden` blocks work-product creation. `redacted-only` prevents a `none` request, defaults the product to redacted export, and causes the general work-product exporter to reject an explicit full-export override. `allowed` collections can request full output but still default to standard redaction. Confidential or restricted selected evidence independently forces redaction, and the work product retains the effective classification and launch-manifest digest for later enforcement.

## Current delivery boundary

Knowledge collections now enforce workspace RBAC, collection policy,
classification-aware previews and exports, and exact run launch resources
through the same immutable catalog, page graph, search, promotion, export, and
proposal transaction. The v1 boundary does not include an extractor framework
or an alternate source/page store; ingestion candidates still arrive through
the reviewed proposal API.

## Code

- Shared contracts: `shared/src/types/knowledge-collection.types.ts`
- Validation: `server/src/schemas/knowledge-collection-schemas.ts`
- File repository: `server/src/storage/knowledge-collection-repository.ts`
- SQLite repository and schema: `server/src/storage/sqlite/knowledge-collection-repository.ts`, `server/src/storage/sqlite/migrations.ts`
- Service and RBAC: `server/src/services/knowledge-collection-service.ts`
- REST routes: `server/src/routes/knowledge-collections.ts`
- Focused verification: `server/src/__tests__/knowledge-collection-service.test.ts`, `server/src/__tests__/routes/knowledge-collections.test.ts`
