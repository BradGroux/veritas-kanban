import { useState } from 'react';
import { ActionIcon, Button, Text } from '@mantine/core';
import { UiModal, OverlayFooter } from '@/components/ui/UiOverlay';
import { UiAction } from '@/components/ui/UiVocabulary';
import { useArchiveSuggestions, useArchiveSprint } from '@/hooks/useTasks';
import { Archive, X, Loader2, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ArchiveSuggestionBanner() {
  const { data: suggestions, isLoading } = useArchiveSuggestions();
  const archiveSprint = useArchiveSprint();
  const [dismissedSprints, setDismissedSprints] = useState<Set<string>>(new Set());
  const [confirmSprint, setConfirmSprint] = useState<string | null>(null);

  if (isLoading || !suggestions?.length) {
    return null;
  }

  // Filter out dismissed suggestions
  const visibleSuggestions = suggestions.filter((s) => !dismissedSprints.has(s.sprint));

  if (visibleSuggestions.length === 0) {
    return null;
  }

  const handleDismiss = (sprint: string) => {
    setDismissedSprints((prev) => new Set(prev).add(sprint));
  };

  const handleArchive = async (sprint: string) => {
    try {
      await archiveSprint.mutateAsync(sprint);
      setConfirmSprint(null);
    } catch {
      // Intentionally silent: error is handled by the mutation's onError callback
    }
  };

  return (
    <>
      <div className="space-y-2 mb-4">
        {visibleSuggestions.map((suggestion) => (
          <div
            key={suggestion.sprint}
            className={cn(
              'flex items-center justify-between gap-4 px-4 py-3 rounded-lg',
              'bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400'
            )}
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 flex-shrink-0" />
              <div>
                <p className="font-medium">Sprint "{suggestion.sprint}" is complete!</p>
                <p className="text-sm opacity-80">
                  All {suggestion.taskCount} task{suggestion.taskCount !== 1 ? 's' : ''} are done.
                  Ready to archive?
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmSprint(suggestion.sprint)}
                disabled={archiveSprint.isPending}
                className="border-green-500/30 hover:bg-green-500/10"
              >
                {archiveSprint.isPending && confirmSprint === suggestion.sprint ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Archive className="h-4 w-4 mr-1" />
                    Archive Sprint
                  </>
                )}
              </Button>
              <ActionIcon
                type="button"
                variant="subtle"
                color="gray"
                size="sm"
                onClick={() => handleDismiss(suggestion.sprint)}
                aria-label={`Dismiss archive suggestion for ${suggestion.sprint}`}
              >
                <X className="h-4 w-4" />
              </ActionIcon>
            </div>
          </div>
        ))}
      </div>

      {/* Confirmation Dialog */}
      <UiModal
        opened={!!confirmSprint}
        onClose={() => setConfirmSprint(null)}
        title={`Archive sprint "${confirmSprint}"?`}
        variant="confirm"
        compound
      >
        <div className="vk-overlay-scroll">
          <Text size="sm" c="dimmed">
            This will archive all{' '}
            {suggestions.find((s) => s.sprint === confirmSprint)?.taskCount || 0} tasks in this
            sprint. You can restore them from the archive later.
          </Text>
        </div>
        <OverlayFooter>
          <UiAction variant="quiet" data-autofocus onClick={() => setConfirmSprint(null)}>
            Cancel
          </UiAction>
          <UiAction
            onClick={() => confirmSprint && handleArchive(confirmSprint)}
            disabled={archiveSprint.isPending}
          >
            {archiveSprint.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Archiving...
              </>
            ) : (
              <>
                <Archive className="h-4 w-4 mr-2" />
                Archive Sprint
              </>
            )}
          </UiAction>
        </OverlayFooter>
      </UiModal>
    </>
  );
}
