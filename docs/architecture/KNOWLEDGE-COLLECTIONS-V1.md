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

## Derived pages and citations

`knowledge-page/v1` stores Markdown-compatible synthesis separately from immutable source evidence. Each page has one canonical stable key, durable aliases, a typed page kind, tags, collection-required metadata, review state, confidence, outgoing page IDs, computed backlinks, and a bounded revision history.

Every material claim carries a stable page-local claim ID and one or more citations to immutable source revision IDs. Citations can include a line range, heading occurrence, JSON pointer, excerpt hash, time range, or an additional excerpt digest. Unknown source revisions fail closed before persistence.

A multi-page update resolves stable keys and aliases against the complete collection. Alias matches revise the existing page and preserve its canonical identity rather than creating a duplicate. Links can target canonical keys, aliases, or page IDs, including other pages in the same batch. The service recomputes all affected backlinks and commits every changed page through one compare-and-set repository batch. File storage uses one locked atomic replacement; SQLite uses one immediate transaction. A stale page digest aborts the whole batch.

Page revisions retain content hashes, claims, links, backlinks, review evidence, actor attribution, request identity, and operation identity. History is capped by the collection's `maxPageVersions` policy. Agents can prepare draft or review-required synthesis, while only administrators can mark a page approved or rejected.

## Storage and API

The file backend keeps collection metadata, source revisions, derived pages, and deduplicated blobs in one lock-protected, atomically replaced `knowledge-collections.json`. SQLite migrations 30 and 31 add unique workspace, slug, source revision, operation, page identity, and stable-key constraints. Both implement the same repository interface.

The initial REST surface is mounted at both `/api/v1/knowledge/collections` and `/api/knowledge/collections`:

| Method | Path                                                     | Purpose                    |
| ------ | -------------------------------------------------------- | -------------------------- |
| `GET`  | `/knowledge/collections`                                 | List readable collections  |
| `POST` | `/knowledge/collections`                                 | Create a collection        |
| `GET`  | `/knowledge/collections/:collectionId`                   | Read collection metadata   |
| `GET`  | `/knowledge/collections/:collectionId/sources`           | List source revisions      |
| `POST` | `/knowledge/collections/:collectionId/sources`           | Register a source revision |
| `GET`  | `/knowledge/collections/:collectionId/sources/:sourceId` | Read source metadata       |
| `GET`  | `/knowledge/collections/:collectionId/pages`             | List derived pages         |
| `GET`  | `/knowledge/collections/:collectionId/pages/:pageId`     | Read a derived page        |

The REST API deliberately returns source metadata, not stored source content. Later ingestion and query services will read snapshots through the repository after applying launch-manifest, redaction, and classification policy.

## Current delivery boundary

This foundation does not yet claim dry-run ingestion proposals, proposal-level atomic apply and reverse, search indexing, query promotion, or cited work-product export. Those layers must consume the immutable catalog and page graph and must not add an alternate source or page store.

The next implementation slices are:

1. digest-bound ingestion proposals with contradictions, index changes, atomic apply, retry, reverse, activity entries, and file/SQLite parity; and
2. raw-versus-derived search, semantic fallback, cited query promotion, redaction, launch-manifest restrictions, and export enforcement.

## Code

- Shared contracts: `shared/src/types/knowledge-collection.types.ts`
- Validation: `server/src/schemas/knowledge-collection-schemas.ts`
- File repository: `server/src/storage/knowledge-collection-repository.ts`
- SQLite repository and schema: `server/src/storage/sqlite/knowledge-collection-repository.ts`, `server/src/storage/sqlite/migrations.ts`
- Service and RBAC: `server/src/services/knowledge-collection-service.ts`
- REST routes: `server/src/routes/knowledge-collections.ts`
- Focused verification: `server/src/__tests__/knowledge-collection-service.test.ts`, `server/src/__tests__/routes/knowledge-collections.test.ts`
