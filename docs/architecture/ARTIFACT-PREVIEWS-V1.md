# Governed Artifact Previews v1

`work-product-artifact-preview/v1` lets an authenticated operator inspect passive file content without serving a host path, mounting the artifact store, or weakening the existing download boundary. Task Work, the Run Timeline, and the Work Products tab consume the same server-owned contract in local desktop and remote-client modes.

## Authorization and identity

Preview requests resolve an opaque Work Product ID and optional immutable version inside the authenticated workspace. The artifact repository revalidates stored size and SHA-256 before returning bytes. The response carries the artifact version, digest, validated media type, source run, redaction state, and exact task, attempt, and producing event. It never contains an absolute path, storage key, credential, provider log location, or raw repository location. Responses use `Cache-Control: private, no-store`.

## Passive renderer boundary

The server selects a renderer from validated bytes and normalized media type:

- `text/plain` and `text/markdown` require bounded strict UTF-8 with no binary signature or null bytes. Artifact-safe Markdown omits links and referenced images and does not interpret raw HTML.
- PNG, JPEG, GIF, and WebP require matching magic bytes, bounded encoded bytes, bounded dimensions and pixels, and bounded animation frames. SVG remains unsupported because it is active XML content.
- PDF is download-only. Existing validation still checks magic bytes, byte/page limits, parser loading, external links, and active document actions. A valid PDF returns `unsupported`, `renderer: "none"`, and no preview bytes, with instructions to download and open it in a preferred PDF viewer. The authorized download route and immutable version binding remain unchanged. The app does not embed a PDF viewer or open a downloaded file automatically.
- CSV uses a bounded quoted-cell parser. Open XML spreadsheets first pass archive entry, decompressed-size, compression-ratio, macro, embedding, connection, and external-link checks before workbook parsing. Both formats cap sheets, rows, columns, cell characters, and total rendered output. Formulas are displayed as inert formula text and are never evaluated.

## Isolated HTML boundary

`text/html` uses a separate defense-in-depth path. The server requires strict UTF-8, caps the source at 512 KiB, parses it with `sanitize-html`, and retains only passive semantic elements and a small set of non-URL accessibility and table attributes. It discards scripts, event handlers, document metadata, refresh directives, links, images, frames, forms, embeds, SVG, media, style supplied by the artifact, and every URL-bearing attribute. The server places the reduced body inside a complete host-owned document with fixed dark-theme styles and a CSP that denies scripts, connections, remote assets, frames, objects, forms, workers, manifests, media, fonts, and navigation.

The web client renders that document only through `iframe.srcdoc` with an empty `sandbox` attribute and `referrerPolicy="no-referrer"`. Omitting `allow-same-origin` gives the document a unique opaque origin; omitting every other sandbox token denies scripts, forms, popups, downloads, pointer-lock, presentation, and top-navigation capabilities. The frame never receives an artifact URL, application cookie, authorization header, API credential, local-file path, or storage authority. The same browser boundary applies in desktop and remote clients. Sanitization improves presentation safety but is not the authority boundary; the iframe sandbox and CSP remain mandatory.

Interactive HTML is not supported. Enabling scripts, same-origin authority, network access, or additional sandbox tokens requires a new versioned policy and security review rather than a compatibility exception.

Preparing, opening, closing, refreshing, and navigating away from an HTML preview append bounded audit records. Records contain only the authenticated actor, opaque product and artifact IDs, version, renderer or state, and passive-mode decision. They never copy document bytes or rendered text.

New responses carry base64 only for bounded raster images. The v1 PDF content shape remains readable for compatibility with older servers, but the client shows the same download instructions rather than embedding those bytes. The browser never receives an artifact filesystem URL.

## Fail-closed states

The contract reports `ready`, `unsupported`, `quarantined`, `expired`, `missing`, `malformed`, `oversized`, or `policy-blocked`. Only `ready` selects a renderer. Every other state returns `renderer: "none"`, no content, a concise operator message, and only the download or associated-app fallback allowed by artifact policy. Parsing errors stay inside the preview modal and cannot crash Task Work, the timeline, or the desktop shell.

Artifacts with an optional retention timestamp fail closed as `expired` after that timestamp and disable both download and associated-app actions.

Truncation is distinct from failure. A ready table can be truncated while reporting the exact enforced limits and reasons.

## Accessibility and interaction

The shared modal traps and restores focus, announces loading and status changes, labels preview and download controls, supports keyboard operation, provides bounded zoom for images, and offers a direct navigation action to the causal timeline event. PDFs have no zoom controls. The authenticated download route remains the authoritative fallback.

## Non-capabilities

This contract does not execute scripts, evaluate spreadsheet formulas, load remote references, edit files, run macros, expose local-file privileges, provide an interactive browser, or replace the authenticated download path. HTML preview is passive and remains inside the isolated boundary above.
