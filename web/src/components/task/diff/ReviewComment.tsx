import { useState } from 'react';
import { ActionIcon, Button, Group, Paper, Text, Textarea } from '@mantine/core';
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
    <Paper className="space-y-2 border-l-2 border-amber-500 bg-amber-500/10 p-2" radius={0}>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.currentTarget.value)}
        placeholder="Add review comment..."
        minRows={2}
        className="text-xs"
        autoFocus
      />
      <Group gap="xs">
        <Button size="sm" onClick={handleSubmit} disabled={!content.trim()}>
          Add Comment
        </Button>
        <Button size="sm" variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
      </Group>
    </Paper>
  );
}

interface CommentDisplayProps {
  comment: ReviewComment;
  onRemove: () => void;
}

export function CommentDisplay({ comment, onRemove }: CommentDisplayProps) {
  return (
    <Paper className="group border-l-2 border-amber-500 bg-amber-500/10 p-2" radius={0}>
      <Group align="flex-start" justify="space-between" wrap="nowrap">
        <Text size="xs" className="whitespace-pre-wrap">
          {sanitizeText(comment.content)}
        </Text>
        <ActionIcon
          aria-label="Remove review comment"
          variant="subtle"
          color="red"
          size="xs"
          onClick={onRemove}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </ActionIcon>
      </Group>
      <Text size="10px" c="dimmed" className="mt-1">
        {new Date(comment.created).toLocaleString()}
      </Text>
    </Paper>
  );
}
