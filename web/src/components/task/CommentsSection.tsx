import { useState } from 'react';
import { MessageSquare, Pencil, Trash2, X, Check } from 'lucide-react';
import {
  ActionIcon,
  Avatar,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { MarkdownEditor } from '@/components/ui/MarkdownEditor';
import { MarkdownRenderer } from '@/components/ui/MarkdownRenderer';
import { useAddComment, useEditComment, useDeleteComment } from '@/hooks/useTasks';
import { useFeatureSettings } from '@/hooks/useFeatureSettings';
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

function CommentItem({
  comment,
  taskId,
  markdownEnabled,
}: {
  comment: Comment;
  taskId: string;
  markdownEnabled: boolean;
}) {
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
      <Paper className="group flex flex-col gap-3 bg-muted/30 p-3 sm:flex-row" radius="md">
        <Avatar color="violet" radius="xl" size="sm" className="flex-shrink-0">
          {getInitials(comment.author)}
        </Avatar>
        <Box className="min-w-0 flex-1">
          <Group align="baseline" gap="xs" className="mb-1" wrap="wrap">
            <Text size="sm" fw={500}>
              {comment.author}
            </Text>
            <Text size="xs" c="dimmed">
              {formatRelativeTime(comment.timestamp)}
            </Text>
            {/* Edit/Delete buttons - visible on hover */}
            <Group
              gap={4}
              className="ml-auto opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            >
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Edit comment"
                onClick={() => {
                  setEditText(comment.text);
                  setIsEditing(true);
                }}
              >
                <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                aria-label="Delete comment"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-3 w-3" />
              </ActionIcon>
            </Group>
          </Group>
          {isEditing ? (
            <Stack gap="xs">
              {markdownEnabled ? (
                <MarkdownEditor
                  value={editText}
                  onChange={setEditText}
                  minHeight={80}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveEdit();
                    }
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
              ) : (
                <Textarea
                  value={editText}
                  onChange={(e) => setEditText(e.currentTarget.value)}
                  className="text-sm min-h-[60px] resize-none"
                  autoFocus
                  aria-label="Edit comment text"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleSaveEdit();
                    }
                    if (e.key === 'Escape') handleCancelEdit();
                  }}
                />
              )}
              <Group gap="xs">
                <Button
                  size="xs"
                  onClick={() => {
                    void handleSaveEdit();
                  }}
                  disabled={!editText.trim() || editComment.isPending}
                  leftSection={<Check className="h-3 w-3" />}
                >
                  Save
                </Button>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={handleCancelEdit}
                  leftSection={<X className="h-3 w-3" />}
                >
                  Cancel
                </Button>
              </Group>
            </Stack>
          ) : (
            <Box className="break-words text-sm text-foreground">
              {markdownEnabled ? (
                <MarkdownRenderer content={comment.text} className="break-words" />
              ) : (
                <p className="whitespace-pre-wrap">{comment.text}</p>
              )}
            </Box>
          )}
        </Box>
      </Paper>

      <Modal
        opened={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete comment?"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will permanently delete this comment by {comment.author}. This action cannot be
            undone.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void handleDelete();
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function CommentsSection({ task }: CommentsSectionProps) {
  const { settings: featureSettings } = useFeatureSettings();
  const markdownEnabled = featureSettings.markdown?.enableMarkdown ?? true;
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
    <Stack gap="md">
      <Group gap="xs">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <Text size="sm" c="dimmed" fw={500}>
          Comments
        </Text>
        {comments.length > 0 && (
          <Text size="xs" c="dimmed">
            ({comments.length})
          </Text>
        )}
      </Group>

      {/* Comments list */}
      {comments.length === 0 ? (
        <Paper className="py-4 text-center" radius="md" withBorder>
          <Text size="sm" c="dimmed" fs="italic">
            No comments yet
          </Text>
        </Paper>
      ) : (
        <Stack gap="sm">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              taskId={task.id}
              markdownEnabled={markdownEnabled}
            />
          ))}
        </Stack>
      )}

      {/* Add comment form */}
      <Stack gap="xs" className="border-t pt-2">
        <Group gap="xs">
          <TextInput
            value={author}
            onChange={(e) => setAuthor(e.currentTarget.value)}
            placeholder="Your name"
            className="w-full text-sm sm:max-w-[180px]"
            disabled={isAdding}
            aria-label="Comment author"
          />
        </Group>
        <Box>
          {markdownEnabled ? (
            <MarkdownEditor
              value={text}
              onChange={setText}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment... (supports Markdown, Cmd/Ctrl+Enter to submit)"
              minHeight={100}
              maxHeight={240}
              disabled={isAdding}
            />
          ) : (
            <Textarea
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a comment... (Cmd/Ctrl+Enter to submit)"
              className="text-sm min-h-[80px] resize-none"
              disabled={isAdding}
              aria-label="Comment text"
            />
          )}
        </Box>
        <Group justify="flex-end">
          <Button
            size="sm"
            onClick={() => {
              void handleAddComment();
            }}
            disabled={!text.trim() || !author.trim() || isAdding}
            className="w-full sm:w-auto"
          >
            Add Comment
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
