import { useState } from 'react';
import { MessageSquare, Pencil, Trash2, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MarkdownText } from '@/components/shared/MarkdownText';
import { useAddComment, useEditComment, useDeleteComment } from '@/hooks/useTasks';
import type { Task, Comment } from '@veritas-kanban/shared';

interface CommentsSectionProps {
  task: Task;
}

function formatRelativeTime(timestamp: string): string {
  const now = new Date();
  const date = new Date(timestamp);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} minute${Math.floor(seconds / 60) === 1 ? '' : 's'} ago`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)} hour${Math.floor(seconds / 3600) === 1 ? '' : 's'} ago`;
  if (seconds < 604800)
    return `${Math.floor(seconds / 86400)} day${Math.floor(seconds / 86400) === 1 ? '' : 's'} ago`;

  return date.toLocaleDateString();
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function CommentItem({ comment, taskId }: { comment: Comment; taskId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(comment.text);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const editComment = useEditComment();
  const deleteComment = useDeleteComment();

  const handleSaveEdit = async () => {
    if (!editText.trim()) return;
    await editComment.mutateAsync({
      taskId,
      commentId: comment.id,
      text: editText.trim(),
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(comment.text);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    await deleteComment.mutateAsync({ taskId, commentId: comment.id });
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <div className="group flex gap-3 p-3 rounded-md bg-muted/30">
        <div className="h-8 w-8 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium">
          {getInitials(comment.author)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-medium text-sm">{comment.author}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(comment.timestamp)}
            </span>
            {/* Edit/Delete buttons - visible on hover */}
            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                aria-label="Edit comment"
                onClick={() => {
                  setEditText(comment.text);
                  setIsEditing(true);
                }}
              >
                <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                aria-label="Delete comment"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          </div>
          {isEditing ? (
            <div className="space-y-2">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="text-sm min-h-[60px] resize-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleSaveEdit();
                  }
                  if (e.key === 'Escape') handleCancelEdit();
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7"
                  onClick={handleSaveEdit}
                  disabled={!editText.trim() || editComment.isPending}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Save
                </Button>
                <Button variant="ghost" size="sm" className="h-7" onClick={handleCancelEdit}>
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-foreground break-words">
              <MarkdownText>{comment.text}</MarkdownText>
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this comment by {comment.author}. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function CommentsSection({ task }: CommentsSectionProps) {
  const [author, setAuthor] = useState('Veritas');
  const [text, setText] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const addComment = useAddComment();

  const comments = task.comments || [];

  const handleAddComment = async () => {
    if (!text.trim() || !author.trim()) return;

    setIsAdding(true);
    try {
      await addComment.mutateAsync({
        taskId: task.id,
        author: author.trim(),
        text: text.trim(),
      });
      setText('');
    } finally {
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleAddComment();
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <Label className="text-muted-foreground">Comments</Label>
        {comments.length > 0 && (
          <span className="text-xs text-muted-foreground">({comments.length})</span>
        )}
      </div>

      {/* Comments list */}
      {comments.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-4 text-center border rounded-md">
          No comments yet
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} taskId={task.id} />
          ))}
        </div>
      )}

      {/* Add comment form */}
      <div className="space-y-2 pt-2 border-t">
        <div className="flex gap-2">
          <Input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Your name"
            className="text-sm max-w-[150px]"
            disabled={isAdding}
          />
        </div>
        <div className="flex gap-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a comment... (supports Markdown, Cmd/Ctrl+Enter to submit)"
            className="text-sm min-h-[80px] resize-none"
            disabled={isAdding}
          />
        </div>
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handleAddComment}
            disabled={!text.trim() || !author.trim() || isAdding}
          >
            Add Comment
          </Button>
        </div>
      </div>
    </div>
  );
}
