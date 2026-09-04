import { useRef, useState } from 'react';
import { Checkbox, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { UiModal as Modal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiAction } from '@/components/ui/UiVocabulary';
import { useCreatePR } from '@/hooks/useGitHub';
import { Loader2, GitPullRequest } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';

interface PRDialogProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PRDialog({ task, open, onOpenChange }: PRDialogProps) {
  const [prTitle, setPrTitle] = useState(task.title);
  const [prBody, setPrBody] = useState(task.description || '');
  const [prDraft, setPrDraft] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const creationInFlight = useRef(false);

  const createPR = useCreatePR();

  const closeDialog = () => {
    if (creationInFlight.current) return;
    setCreateError(null);
    onOpenChange(false);
  };

  const handleCreatePR = async () => {
    if (creationInFlight.current || !prTitle.trim()) return;
    creationInFlight.current = true;
    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await createPR.mutateAsync({
        taskId: task.id,
        title: prTitle,
        body: prBody,
        draft: prDraft,
      });
      onOpenChange(false);
      // Open the new PR in browser
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create pull request.');
    } finally {
      creationInFlight.current = false;
      setIsCreating(false);
    }
  };

  return (
    <Modal compound opened={open} onClose={closeDialog} title="Create Pull Request" centered>
      <Stack gap="md" className="vk-overlay-scroll">
        <Text size="sm" c="dimmed">
          Create a PR from {task.git?.branch} to {task.git?.baseBranch}
        </Text>
        <TextInput
          id="pr-title"
          label="Title"
          value={prTitle}
          disabled={isCreating}
          onChange={(e) => setPrTitle(e.currentTarget.value)}
          placeholder="PR title"
        />
        <Textarea
          id="pr-body"
          label="Description"
          value={prBody}
          disabled={isCreating}
          onChange={(e) => setPrBody(e.currentTarget.value)}
          placeholder="Describe your changes..."
          minRows={5}
        />
        <Checkbox
          id="pr-draft"
          label="Create as draft PR"
          checked={prDraft}
          disabled={isCreating}
          onChange={(event) => setPrDraft(event.currentTarget.checked)}
        />
        {createError && (
          <Text size="sm" c="red" role="alert">
            {createError}
          </Text>
        )}
      </Stack>
      <OverlayFooter>
        <UiAction variant="quiet" onClick={closeDialog} disabled={isCreating}>
          Cancel
        </UiAction>
        <UiAction
          onClick={() => {
            void handleCreatePR();
          }}
          disabled={isCreating || !prTitle.trim()}
          leftSection={
            isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitPullRequest className="h-4 w-4" />
            )
          }
        >
          {isCreating ? 'Creating...' : 'Create PR'}
        </UiAction>
      </OverlayFooter>
    </Modal>
  );
}
