import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';
import { cn } from '@/lib/utils';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const components: Components = {
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

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const { settings } = useFeatureSettings();
  const enableCodeHighlighting = settings.markdown?.enableCodeHighlighting ?? true;

  if (!content) return null;

  return (
    <div className={cn('prose prose-sm max-w-none dark:prose-invert', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={enableCodeHighlighting ? [rehypeHighlight] : []}
        components={components}
        urlTransform={(url) => {
          if (url.match(/^\s*javascript:/i)) return '#';
          return url;
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
