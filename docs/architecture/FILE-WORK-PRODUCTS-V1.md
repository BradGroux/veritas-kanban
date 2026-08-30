# File-Backed Work Products v1

File-backed Work Products are finished user deliverables such as PDFs, spreadsheets, images, office documents, and generated web pages. They are distinct from repository changes, user attachments, and oversized run-output spill artifacts.

## Authority and registration

An eligible run receives one private `VERITAS_ARTIFACT_ROOT` directory under its run sandbox. The launch manifest records that exact root as a `run-artifact` write grant. Runs without an enforceable grant do not receive the directory or environment variable, and registration fails closed.

The producer writes a complete file below that root, then registers it through `POST /api/v1/work-products/artifacts/register` or `vk work-products register`. Registration accepts only a relative path and never persists or returns the host root.

Before copying bytes, the source reader rejects absolute paths, traversal and control characters, symlinks, hard links, directories and other special files, files over 64 MiB, paths whose canonical target leaves the granted root, and files whose identity, size, or modification time changes during the read. The source is opened without following a final symlink.

## Durable contract

Each immutable artifact version records:

- opaque artifact and Work Product IDs
- Work Product version and workspace, task, run, and attempt IDs
- causal producing event and launch-manifest digest
- SHA-256 request digest for idempotency
- media type, byte size, SHA-256 content digest, and safe filename
- available, quarantined, or deleted state plus redaction or quarantine reason
- creation timestamp

Registration copies verified bytes into the selected storage backend before publishing the Work Product version. File storage uses an exclusive temporary directory, complete write loops, file sync, and atomic rename. SQLite stores the metadata and BLOB in one immediate transaction. Reads verify size and SHA-256 before returning bytes.

A stable request ID is idempotent, including after newer versions exist. Concurrent registration for the same Work Product is serialized in the server, storage creation is conflict-safe, and the causal `artifact.created` event uses a stable dedupe key.

## Presentation and download

Task Work, the Work Products tab, and the Run Timeline show the safe filename, media type, byte size, digest, state, attempt, and producing event. Available files use the authenticated download endpoint. Quarantined files show the operator-visible reason and do not expose bytes.

Download responses use `Content-Disposition: attachment`, `Content-Digest`, `X-Artifact-SHA256`, an immutable ETag, and private immutable caching. The server revalidates stored size and digest for every download.

## Lifecycle

Archiving a Work Product does not delete its file versions; archived artifacts remain available to authorized downloads. Maintenance accounting includes each stored body once. Physical cleanup is never automatic: `DELETE /api/v1/work-products/:id/artifact?confirm=:id` and `vk work-products purge :id --confirm :id` require an archived file Work Product and an exact ID confirmation, then remove every immutable body plus the Work Product and version records. The causal run journal remains as bounded audit evidence that the artifact existed.

File-backend backups recursively preserve the private artifact directory. SQLite export format 3 includes `work_product_artifacts` and encodes BLOB values for exact import. Workspace-scoped exports filter the table by `workspace_id`.

Support/debug bundles include bounded lifecycle metadata only. File Work Product bodies and raw run-output artifact bodies are explicitly excluded.

## Non-goals

- inline execution or rich preview of generated files
- arbitrary worktree or host-file registration
- treating artifact output as source-repository write authority
- replacing user attachments or run-output spill storage
