import { useCallback, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Code, Link2, List, Heading2, Code2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number | string;
  maxHeight?: number | string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
}

type SelectionUpdate = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

const TOOLBAR_BUTTONS = [
  { id: 'bold', label: 'Bold', icon: Bold },
  { id: 'italic', label: 'Italic', icon: Italic },
  { id: 'code', label: 'Inline code', icon: Code },
  { id: 'link', label: 'Link', icon: Link2 },
  { id: 'list', label: 'List', icon: List },
  { id: 'heading', label: 'Heading', icon: Heading2 },
  { id: 'codeblock', label: 'Code block', icon: Code2 },
] as const;

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  minHeight = 120,
  maxHeight,
  onKeyDown,
  disabled = false,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState('edit');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const applySelectionUpdate = useCallback(
    (update: (current: string, start: number, end: number) => SelectionUpdate) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const {
        selectionStart,
        selectionEnd,
        value: nextValue,
      } = update(value, textarea.selectionStart, textarea.selectionEnd);

      onChange(nextValue);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(selectionStart, selectionEnd);
      });
    },
    [onChange, value]
  );

  const wrapSelection = useCallback(
    (before: string, after = before, placeholderText = '') => {
      applySelectionUpdate((current, start, end) => {
        const selected = current.slice(start, end) || placeholderText;
        const nextValue = `${current.slice(0, start)}${before}${selected}${after}${current.slice(end)}`;
        const cursorStart = start + before.length;
        const cursorEnd = cursorStart + selected.length;
        return { value: nextValue, selectionStart: cursorStart, selectionEnd: cursorEnd };
      });
    },
    [applySelectionUpdate]
  );

  const prefixLines = useCallback(
    (prefix: string) => {
      applySelectionUpdate((current, start, end) => {
        const lineStart = current.lastIndexOf('\n', start - 1) + 1;
        const lineEndIndex = current.indexOf('\n', end);
        const lineEnd = lineEndIndex === -1 ? current.length : lineEndIndex;
        const block = current.slice(lineStart, lineEnd);
        const updatedBlock = block
          .split('\n')
          .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
          .join('\n');

        const nextValue = `${current.slice(0, lineStart)}${updatedBlock}${current.slice(lineEnd)}`;
        return {
          value: nextValue,
          selectionStart: lineStart,
          selectionEnd: lineStart + updatedBlock.length,
        };
      });
    },
    [applySelectionUpdate]
  );

  const insertLink = useCallback(() => {
    applySelectionUpdate((current, start, end) => {
      const selected = current.slice(start, end) || 'link text';
      const urlPlaceholder = 'https://';
      const nextValue = `${current.slice(0, start)}[${selected}](${urlPlaceholder})${current.slice(end)}`;
      const urlStart = start + selected.length + 3;
      return {
        value: nextValue,
        selectionStart: urlStart,
        selectionEnd: urlStart + urlPlaceholder.length,
      };
    });
  }, [applySelectionUpdate]);

  const insertCodeBlock = useCallback(() => {
    applySelectionUpdate((current, start, end) => {
      const selected = current.slice(start, end) || 'code';
      const nextValue = `${current.slice(0, start)}\n\`\`\`\n${selected}\n\`\`\`\n${current.slice(end)}`;
      return {
        value: nextValue,
        selectionStart: start + 5,
        selectionEnd: start + 5 + selected.length,
      };
    });
  }, [applySelectionUpdate]);

  const handleToolbarAction = useCallback(
    (action: (typeof TOOLBAR_BUTTONS)[number]['id']) => {
      switch (action) {
        case 'bold':
          wrapSelection('**', '**', 'bold text');
          return;
        case 'italic':
          wrapSelection('_', '_', 'italic text');
          return;
        case 'code':
          wrapSelection('`', '`', 'code');
          return;
        case 'link':
          insertLink();
          return;
        case 'list':
          prefixLines('- ');
          return;
        case 'heading':
          prefixLines('# ');
          return;
        case 'codeblock':
          insertCodeBlock();
          return;
        default:
          return;
      }
    },
    [insertCodeBlock, insertLink, prefixLines, wrapSelection]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
      if (event.key.toLowerCase() === 'b') {
        event.preventDefault();
        wrapSelection('**', '**', 'bold text');
        return;
      }
      if (event.key.toLowerCase() === 'i') {
        event.preventDefault();
        wrapSelection('_', '_', 'italic text');
        return;
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        insertLink();
        return;
      }
    }

    onKeyDown?.(event);
  };

  const previewContent = useMemo(() => value?.trim(), [value]);

  return (
    <Tabs value={mode} onValueChange={setMode} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {TOOLBAR_BUTTONS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label={label}
              onClick={() => handleToolbarAction(id)}
              type="button"
              disabled={disabled}
            >
              <Icon className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
        <TabsList className="ml-auto">
          <TabsTrigger value="edit" className="text-xs">
            Edit
          </TabsTrigger>
          <TabsTrigger value="preview" className="text-xs">
            Preview
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="edit" className="mt-0">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn('resize-none')}
          style={{ minHeight, maxHeight }}
          disabled={disabled}
        />
      </TabsContent>

      <TabsContent value="preview" className="mt-0">
        <div
          className={cn(
            'rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground/80',
            !previewContent && 'text-muted-foreground italic'
          )}
          style={{ minHeight, maxHeight }}
        >
          {previewContent ? <MarkdownRenderer content={value} /> : <span>Nothing to preview</span>}
        </div>
      </TabsContent>
    </Tabs>
  );
}
