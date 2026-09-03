import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';

interface MarkdownRendererProps {
  content: string;
  className?: string;
  artifactSafe?: boolean;
  /** Heading level for a Markdown h1 when embedded beneath a host section. */
  headingStartLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold mt-4 mb-2 text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold mt-3 mb-2 text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold mt-3 mb-1 text-foreground">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-2 mb-1 text-foreground">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-medium mt-2 mb-1 text-muted-foreground">{children}</h6>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-sm">{children}</pre>
  ),
  code: ({ children, className, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm" {...props}>
          {children}
        </code>
      );
    }

    return (
      <code className={cn('text-sm', className)} {...props}>
        {children}
      </code>
    );
  },
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

export function MarkdownRenderer({
  content,
  className,
  artifactSafe = false,
  headingStartLevel = 1,
}: MarkdownRendererProps) {
  const { settings } = useFeatureSettings();
  const enableCodeHighlighting = settings.markdown?.enableCodeHighlighting ?? true;

  if (!content) return null;

  const headingTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
  const embeddedComponents: Components = {
    ...components,
    ...Object.fromEntries(
      headingTags.map((tag, index) => [
        tag,
        components[headingTags[Math.min(index + headingStartLevel - 1, 5)]],
      ])
    ),
  };

  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={enableCodeHighlighting ? [rehypeHighlight] : []}
        components={
          artifactSafe
            ? {
                ...embeddedComponents,
                a: ({ children }) => <span>{children} (external link omitted)</span>,
                img: ({ alt }) => <span>[image omitted{alt ? `: ${alt}` : ''}]</span>,
              }
            : embeddedComponents
        }
        urlTransform={(url) => {
          if (artifactSafe) return '';
          if (url.match(/^\s*javascript:/i)) return '#';
          return url;
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
