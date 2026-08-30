import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ArtifactSafeMarkdown({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ children }) => <span>{children} (external link omitted)</span>,
          img: ({ alt }) => <span>[image omitted{alt ? `: ${alt}` : ''}]</span>,
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-sm">{children}</pre>
          ),
        }}
        urlTransform={() => ''}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
