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

## Storage and API

The file backend keeps collection metadata, source revisions, and deduplicated blobs in one lock-protected, atomically replaced `knowledge-collections.json`. The SQLite backend uses migration 30 and unique workspace, slug, source revision, and operation constraints. Both implement the same repository interface.

The initial REST surface is mounted at both `/api/v1/knowledge/collections` and `/api/knowledge/collections`:

| Method | Path                                          | Purpose                       |
| ------ | --------------------------------------------- | ----------------------------- |
| `GET`  | `/knowledge/collections`                      | List readable collections     |
| `POST` | `/knowledge/collections`                      | Create a collection           |
| `GET`  | `/knowledge/collections/:collectionId`        | Read collection metadata      |
| `GET`  | `/knowledge/collections/:collectionId/sources` | List source revisions         |
| `POST` | `/knowledge/collections/:collectionId/sources` | Register a source revision    |
| `GET`  | `/knowledge/collections/:collectionId/sources/:sourceId` | Read source metadata |

The REST API deliberately returns source metadata, not stored source content. Later ingestion and query services will read snapshots through the repository after applying launch-manifest, redaction, and classification policy.

## Current delivery boundary

This foundation does not yet claim derived knowledge pages, claim-level citations, dry-run ingestion proposals, atomic multi-page apply and reverse, identity-aware page updates, search indexing, query promotion, or cited work-product export. Those layers must consume the immutable catalog and must not add an alternate source store.

The next implementation slices are:

1. versioned derived pages with stable identity, aliases, backlinks, claim citations, contradictions, review state, and bounded history;
2. digest-bound ingestion proposals with atomic apply, retry, rollback, activity entries, and file/SQLite parity; and
3. raw-versus-derived search, semantic fallback, cited query promotion, redaction, launch-manifest restrictions, and export enforcement.

## Code

- Shared contracts: `shared/src/types/knowledge-collection.types.ts`
- Validation: `server/src/schemas/knowledge-collection-schemas.ts`
- File repository: `server/src/storage/knowledge-collection-repository.ts`
- SQLite repository and schema: `server/src/storage/sqlite/knowledge-collection-repository.ts`, `server/src/storage/sqlite/migrations.ts`
- Service and RBAC: `server/src/services/knowledge-collection-service.ts`
- REST routes: `server/src/routes/knowledge-collections.ts`
- Focused verification: `server/src/__tests__/knowledge-collection-service.test.ts`, `server/src/__tests__/routes/knowledge-collections.test.ts`
