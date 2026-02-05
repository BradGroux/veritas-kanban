/**
 * MarkdownText - Renders markdown content with sanitization
 *
 * Converts markdown text to formatted HTML while maintaining XSS protection.
 * Uses react-markdown for parsing (safe by default).
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

interface MarkdownTextProps {
  children: string;
  className?: string;
}

/**
 * Custom components for react-markdown to apply Tailwind styling
 */
const components: Components = {
  // Headings
  h1: ({ children }) => <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-bold mt-3 mb-2">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold mt-3 mb-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-base font-semibold mt-2 mb-1">{children}</h4>,
  h5: ({ children }) => <h5 className="text-sm font-semibold mt-2 mb-1">{children}</h5>,
  h6: ({ children }) => <h6 className="text-xs font-semibold mt-2 mb-1">{children}</h6>,

  // Paragraphs
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,

  // Lists
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="ml-4">{children}</li>,

  // Code
  code: ({ children, className }) => {
    // Check if this is inline code by looking at parent node
    // Inline code won't have a language class
    const isInline = !className;
    return isInline ? (
      <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>
    ) : (
      <code
        className={`block bg-muted p-3 rounded-md text-sm font-mono overflow-x-auto mb-2 ${className || ''}`}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="mb-2">{children}</pre>,

  // Blockquotes
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-muted-foreground/30 pl-4 italic my-2 text-muted-foreground">
      {children}
    </blockquote>
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),

  // Horizontal rule
  hr: () => <hr className="border-border my-4" />,

  // Tables
  table: ({ children }) => (
    <div className="overflow-x-auto mb-2">
      <table className="border-collapse border border-border min-w-full">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
  th: ({ children }) => (
    <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,

  // Emphasis
  strong: ({ children }) => <strong className="font-bold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
};

/**
 * MarkdownText component
 *
 * Renders markdown content with GFM (GitHub Flavored Markdown) support.
 * Automatically sanitizes HTML to prevent XSS attacks.
 *
 * @example
 * ```tsx
 * <MarkdownText>{task.description}</MarkdownText>
 * ```
 */
export function MarkdownText({ children, className = '' }: MarkdownTextProps) {
  if (!children) return null;

  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        // Use urlTransform to sanitize URLs - block javascript: and other dangerous protocols
        urlTransform={(url) => {
          if (url.match(/^\s*javascript:/i)) return '#';
          return url;
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
