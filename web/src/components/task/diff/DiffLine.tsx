import { memo, useMemo } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { CommentInput, CommentDisplay } from './ReviewComment';
import type { DiffLine } from '@/lib/api';
import type { ReviewComment } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';

interface DiffLineProps {
  line: DiffLine;
  comments: ReviewComment[];
  addingCommentAtLine: number | null;
  onStartAddComment: (line: number) => void;
  onSubmitComment: (content: string) => void;
  onCancelComment: () => void;
  onRemoveComment: (commentId: string) => void;
}

export const DiffLineView = memo(function DiffLineView({
  line,
  comments,
  addingCommentAtLine,
  onStartAddComment,
  onSubmitComment,
  onCancelComment,
  onRemoveComment,
}: DiffLineProps) {
  const lineNumber = line.newNumber || line.oldNumber;
  const lineComments = useMemo(
    () => comments.filter((c) => c.line === lineNumber),
    [comments, lineNumber]
  );
  const isAddingHere = addingCommentAtLine === lineNumber;

  return (
    <>
      <div
        className={cn(
          'group flex hover:bg-muted/30',
          line.type === 'add' && 'bg-green-500/10',
          line.type === 'delete' && 'bg-red-500/10',
          lineComments.length > 0 && 'bg-amber-500/5'
        )}
      >
        {/* Line numbers */}
        <div className="flex-shrink-0 w-20 flex text-muted-foreground select-none border-r border-border">
          <span className="w-10 px-2 text-right border-r border-border text-[10px]">
            {line.oldNumber || ''}
          </span>
          <span className="w-10 px-2 text-right text-[10px]">{line.newNumber || ''}</span>
        </div>

        {/* Add comment button */}
        {lineNumber && (
          <button
            onClick={() => onStartAddComment(lineNumber)}
            className="veritas-secondary-action w-6 flex-shrink-0 flex items-center justify-center text-muted-foreground hover:text-amber-500"
            aria-label={`Add comment to line ${lineNumber}`}
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        )}

        {/* Change indicator */}
        <div className="w-6 flex-shrink-0 flex items-center justify-center">
          {line.type === 'add' && <span className="text-green-500">+</span>}
          {line.type === 'delete' && <span className="text-red-500">-</span>}
        </div>

        {/* Content */}
        <pre className="flex-1 px-2 overflow-x-auto whitespace-pre text-xs">
          {line.content || ' '}
        </pre>

        {/* Comment indicator */}
        {lineComments.length > 0 && (
          <div className="flex-shrink-0 px-2 flex items-center">
            <MessageSquare className="h-3 w-3 text-amber-500" />
          </div>
        )}
      </div>

      {/* Inline comments */}
      {lineComments.map((comment) => (
        <CommentDisplay
          key={comment.id}
          comment={comment}
          onRemove={() => onRemoveComment(comment.id)}
        />
      ))}

      {/* Comment input */}
      {isAddingHere && <CommentInput onSubmit={onSubmitComment} onCancel={onCancelComment} />}
    </>
  );
});
