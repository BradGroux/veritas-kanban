import { useState } from 'react';
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

  const createPR = useCreatePR();

  const handleCreatePR = async () => {
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
    } catch {
      // Intentionally silent: error is handled by the mutation's onError callback
    }
  };

  return (
    <Modal
      compound
      opened={open}
      onClose={() => onOpenChange(false)}
      title="Create Pull Request"
      centered
    >
      <Stack gap="md" className="vk-overlay-scroll">
        <Text size="sm" c="dimmed">
          Create a PR from {task.git?.branch} to {task.git?.baseBranch}
        </Text>
        <TextInput
          id="pr-title"
          label="Title"
          value={prTitle}
          onChange={(e) => setPrTitle(e.currentTarget.value)}
          placeholder="PR title"
        />
        <Textarea
          id="pr-body"
          label="Description"
          value={prBody}
          onChange={(e) => setPrBody(e.currentTarget.value)}
          placeholder="Describe your changes..."
          minRows={5}
        />
        <Checkbox
          id="pr-draft"
          label="Create as draft PR"
          checked={prDraft}
          onChange={(event) => setPrDraft(event.currentTarget.checked)}
        />
        {createPR.error && (
          <Text size="sm" c="red">
            {(createPR.error as Error).message}
          </Text>
        )}
      </Stack>
      <OverlayFooter>
        <UiAction variant="quiet" onClick={() => onOpenChange(false)}>
          Cancel
        </UiAction>
        <UiAction
          onClick={() => {
            void handleCreatePR();
          }}
          disabled={createPR.isPending || !prTitle}
          leftSection={
            createPR.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <GitPullRequest className="h-4 w-4" />
            )
          }
        >
          {createPR.isPending ? 'Creating...' : 'Create PR'}
        </UiAction>
      </OverlayFooter>
    </Modal>
  );
}
