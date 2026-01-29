/**
 * VisuallyHidden — Renders content that is visually hidden but accessible
 * to screen readers. Wraps Tailwind's sr-only class in a reusable component.
 *
 * WCAG 2.1 Success Criterion 1.3.1 — Info and Relationships
 * Use when visual context conveys meaning that screen readers cannot infer.
 *
 * For simple cases, prefer Tailwind's `sr-only` class directly.
 */
interface VisuallyHiddenProps {
  children: React.ReactNode;
  /** Render as a specific element (default: span) */
  as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'label';
}

export function VisuallyHidden({ children, as: Component = 'span' }: VisuallyHiddenProps) {
  return <Component className="sr-only">{children}</Component>;
}
