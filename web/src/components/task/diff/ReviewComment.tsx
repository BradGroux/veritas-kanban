import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import type { ReviewComment } from '@veritas-kanban/shared';
import { sanitizeText } from '@/lib/sanitize';

interface CommentInputProps {
  onSubmit: (content: string) => void;
  onCancel: () => void;
}

export function CommentInput({ onSubmit, onCancel }: CommentInputProps) {
  const [content, setContent] = useState('');

  const handleSubmit = () => {
    if (content.trim()) {
      onSubmit(content.trim());
      setContent('');
    }
  };

  return (
    <div className="p-2 bg-amber-500/10 border-l-2 border-amber-500 space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add review comment..."
        rows={2}
        className="text-xs"
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!content.trim()}>
          Add Comment
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface CommentDisplayProps {
  comment: ReviewComment;
  onRemove: () => void;
}

export function CommentDisplay({ comment, onRemove }: CommentDisplayProps) {
  return (
    <div className="p-2 bg-amber-500/10 border-l-2 border-amber-500 group">
      <div className="flex items-start justify-between">
        <p className="text-xs whitespace-pre-wrap">{sanitizeText(comment.content)}</p>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {new Date(comment.created).toLocaleString()}
      </p>
    </div>
  );
}
