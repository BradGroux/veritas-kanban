# Governed Artifact Previews v1

`work-product-artifact-preview/v1` lets an authenticated operator inspect passive file content without serving a host path, mounting the artifact store, or weakening the existing download boundary. Task Work, the Run Timeline, and the Work Products tab consume the same server-owned contract in local desktop and remote-client modes.

## Authorization and identity

Preview requests resolve an opaque Work Product ID and optional immutable version inside the authenticated workspace. The artifact repository revalidates stored size and SHA-256 before returning bytes. The response carries the artifact version, digest, validated media type, source run, redaction state, and exact task, attempt, and producing event. It never contains an absolute path, storage key, credential, provider log location, or raw repository location. Responses use `Cache-Control: private, no-store`.

## Passive renderer boundary

The server selects a renderer from validated bytes and normalized media type:

- `text/plain` and `text/markdown` require bounded strict UTF-8 with no binary signature or null bytes. Artifact-safe Markdown omits links and referenced images and does not interpret raw HTML.
- PNG, JPEG, GIF, and WebP require matching magic bytes, bounded encoded bytes, bounded dimensions and pixels, and bounded animation frames. SVG remains unsupported because it is active XML content.
- PDF requires valid PDF magic, bounded bytes and pages, successful parser loading, no external links, and no JavaScript, launch actions, embedded files, forms, rich media, or other active document actions. The client places approved bytes in a sandboxed data-origin frame with no referrer.
- CSV uses a bounded quoted-cell parser. Open XML spreadsheets first pass archive entry, decompressed-size, compression-ratio, macro, embedding, connection, and external-link checks before workbook parsing. Both formats cap sheets, rows, columns, cell characters, and total rendered output. Formulas are displayed as inert formula text and are never evaluated.

The JSON contract may carry base64 only for bounded raster and passive PDF bytes. The browser never receives an artifact filesystem URL.

## Fail-closed states

The contract reports `ready`, `unsupported`, `quarantined`, `expired`, `missing`, `malformed`, `oversized`, or `policy-blocked`. Only `ready` selects a renderer. Every other state returns `renderer: "none"`, no content, a concise operator message, and only the download or associated-app fallback allowed by artifact policy. Parsing errors stay inside the preview modal and cannot crash Task Work, the timeline, or the desktop shell.

Artifacts with an optional retention timestamp fail closed as `expired` after that timestamp and disable both download and associated-app actions.

Truncation is distinct from failure. A ready table can be truncated while reporting the exact enforced limits and reasons.

## Accessibility and interaction

The shared modal traps and restores focus, announces loading and status changes, labels preview and download controls, supports keyboard operation, provides bounded zoom for images and PDFs, and offers a direct navigation action to the causal timeline event. The authenticated download route remains the authoritative fallback.

## Non-capabilities

This contract does not render HTML, execute scripts, evaluate spreadsheet formulas, load remote references, edit files, run macros, expose local-file privileges, or replace the authenticated download path. HTML requires a separate isolated-origin security boundary.
