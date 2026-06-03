# CSP Style Policy

Veritas Kanban production HTTP responses use Helmet CSP with per-request
nonces. Production `style-src` no longer includes broad `'unsafe-inline'`.

## Runtime Policy

- `script-src` allows same-origin scripts and the per-request nonce.
- `style-src` and `style-src-elem` allow same-origin stylesheets and
  nonce-bearing inline `<style>` elements.
- `style-src-attr` is the only remaining inline style exception and is scoped to
  style attributes.
- `/api-docs` removes the CSP header only for Swagger UI, which still ships
  inline scripts and styles.

## Inline Style Inventory

The React app still uses dynamic `style={...}` attributes for:

- Progress and utilization widths in dashboard, activity, scoring, and task
  metrics views.
- Drag/drop transform and sortable item positioning.
- Runtime status colors, color chips, and chart legend markers.
- Markdown editor height constraints and attachment preview sizing.

Those values are computed at runtime, so CSP hashes are not practical yet. The
current policy keeps those attributes working through `style-src-attr` while
blocking arbitrary inline `<style>` elements unless they carry the server nonce.

## Static Desktop Pages

The desktop startup and failure/status pages are isolated static documents with
`default-src 'none'` and no scripts. Their inline `<style>` blocks are allowed by
CSS hashes, not by `'unsafe-inline'`.

## Migration Path

Remove the remaining `style-src-attr 'unsafe-inline'` allowance once the dynamic
style attributes above have moved to CSS custom properties, data attributes, or
bounded class mappings.
