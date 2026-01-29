/**
 * SkipToContent — "Skip to main content" link that becomes visible on focus.
 *
 * WCAG 2.1 Success Criterion 2.4.1 — Bypass Blocks
 * Allows keyboard users to skip repetitive navigation and jump straight to content.
 */
export function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="
        sr-only focus:not-sr-only
        focus:fixed focus:top-2 focus:left-2 focus:z-[100]
        focus:px-4 focus:py-2 focus:rounded-md
        focus:bg-primary focus:text-primary-foreground
        focus:text-sm focus:font-medium
        focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
        focus:shadow-lg
      "
    >
      Skip to main content
    </a>
  );
}
