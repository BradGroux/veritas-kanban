import { useState, useEffect } from 'react';
import {
  Button,
  Code,
  Drawer,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import {
  useConflictStatus,
  useFileConflict,
  useResolveConflict,
  useAbortConflict,
  useContinueConflict,
} from '@/hooks/useConflicts';
import {
  AlertTriangle,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Loader2,
  ArrowLeft,
  ArrowRight,
  GitMerge,
} from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';

interface ConflictResolverProps {
  task: Task;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConflictResolver({ task, open, onOpenChange }: ConflictResolverProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [manualContent, setManualContent] = useState('');
  const [showAbortDialog, setShowAbortDialog] = useState(false);

  const { data: status, isLoading: statusLoading } = useConflictStatus(open ? task.id : undefined);
  const { data: fileConflict, isLoading: fileLoading } = useFileConflict(
    open && selectedFile ? task.id : undefined,
    selectedFile || undefined
  );

  const resolveConflict = useResolveConflict();
  const abortConflict = useAbortConflict();
  const continueConflict = useContinueConflict();

  // Auto-select first file if none selected
  useEffect(() => {
    if (status?.conflictingFiles.length && !selectedFile) {
      setSelectedFile(status.conflictingFiles[0]);
    }
  }, [status?.conflictingFiles, selectedFile]);

  const handleResolve = async (resolution: 'ours' | 'theirs' | 'manual') => {
    if (!selectedFile) return;

    await resolveConflict.mutateAsync({
      taskId: task.id,
      filePath: selectedFile,
      resolution,
      manualContent: resolution === 'manual' ? manualContent : undefined,
    });

    // Move to next file or close if done
    const remaining = status?.conflictingFiles.filter((f) => f !== selectedFile) || [];
    if (remaining.length > 0) {
      setSelectedFile(remaining[0]);
    } else {
      setSelectedFile(null);
    }
  };

  const handleAbort = async () => {
    await abortConflict.mutateAsync(task.id);
    setShowAbortDialog(false);
    onOpenChange(false);
  };

  const handleContinue = async () => {
    const result = await continueConflict.mutateAsync({ taskId: task.id });
    if (result.success) {
      onOpenChange(false);
    }
  };

  const currentIndex =
    selectedFile && status?.conflictingFiles ? status.conflictingFiles.indexOf(selectedFile) : -1;

  const navigateFile = (direction: 'prev' | 'next') => {
    if (!status?.conflictingFiles.length) return;

    let newIndex = currentIndex;
    if (direction === 'prev') {
      newIndex = currentIndex > 0 ? currentIndex - 1 : status.conflictingFiles.length - 1;
    } else {
      newIndex = currentIndex < status.conflictingFiles.length - 1 ? currentIndex + 1 : 0;
    }
    setSelectedFile(status.conflictingFiles[newIndex]);
  };

  // Initialize manual content when file changes
  useEffect(() => {
    if (fileConflict) {
      setManualContent(fileConflict.content);
    }
  }, [fileConflict]);

  return (
    <>
      <Drawer
        opened={open}
        onClose={() => onOpenChange(false)}
        position="right"
        size="90vw"
        padding={0}
        title={
          <Group gap="xs">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <Text fw={600}>Merge Conflicts</Text>
          </Group>
        }
      >
        <Stack gap={0} className="h-[calc(100vh-64px)]">
          <Group justify="space-between" align="center" className="border-b px-6 py-4">
            <Text size="sm" c="dimmed">
              {status?.rebaseInProgress ? 'Rebase' : 'Merge'} has conflicts that need to be resolved
            </Text>

            <Group gap="xs">
              {status?.conflictingFiles.length === 0 && (
                <Button
                  onClick={handleContinue}
                  disabled={continueConflict.isPending}
                  leftSection={
                    continueConflict.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <GitMerge className="h-4 w-4" />
                    )
                  }
                >
                  Continue {status?.rebaseInProgress ? 'Rebase' : 'Merge'}
                </Button>
              )}
              <Button
                variant="outline"
                color="red"
                onClick={() => setShowAbortDialog(true)}
                leftSection={<X className="h-4 w-4" />}
              >
                Abort
              </Button>
            </Group>
          </Group>

          <div className="flex flex-1 overflow-hidden">
            {/* File list sidebar */}
            <div className="w-64 border-r flex flex-col">
              <div className="p-3 border-b bg-muted/50">
                <Text size="sm" fw={500}>
                  Conflicting Files ({status?.conflictingFiles.length || 0})
                </Text>
              </div>
              <ScrollArea className="flex-1">
                {statusLoading ? (
                  <Stack align="center" gap="xs" className="p-4" c="dimmed">
                    <Loader color="gray" size="sm" />
                    <Text size="sm" c="dimmed">
                      Loading...
                    </Text>
                  </Stack>
                ) : status?.conflictingFiles.length === 0 ? (
                  <Stack align="center" gap="xs" className="p-4">
                    <Check className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <Text size="sm" c="dimmed">
                      All conflicts resolved!
                    </Text>
                  </Stack>
                ) : (
                  <div className="p-2">
                    {status?.conflictingFiles.map((file) => (
                      <button
                        key={file}
                        onClick={() => setSelectedFile(file)}
                        className={cn(
                          'w-full text-left px-3 py-2 rounded-md text-sm truncate',
                          'hover:bg-muted transition-colors',
                          selectedFile === file && 'bg-muted font-medium'
                        )}
                      >
                        <FileWarning className="h-3 w-3 inline mr-2 text-amber-500" />
                        {file.split('/').pop()}
                        <span className="text-xs text-muted-foreground block truncate pl-5">
                          {file}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Main content area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedFile && fileConflict ? (
                <>
                  {/* File header with navigation */}
                  <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => navigateFile('prev')}
                        disabled={!status?.conflictingFiles.length}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Text size="sm">
                        {currentIndex + 1} of {status?.conflictingFiles.length}
                      </Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => navigateFile('next')}
                        disabled={!status?.conflictingFiles.length}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <Code>{selectedFile}</Code>
                  </div>

                  {/* Conflict viewer tabs */}
                  <Tabs defaultValue="sidebyside" className="flex-1 flex flex-col overflow-hidden">
                    <Tabs.List className="mx-4 mt-2 w-fit">
                      <Tabs.Tab value="sidebyside">Side by Side</Tabs.Tab>
                      <Tabs.Tab value="manual">Manual Edit</Tabs.Tab>
                    </Tabs.List>

                    {/* Side by side view */}
                    <Tabs.Panel value="sidebyside" className="m-0 flex-1 overflow-hidden p-4">
                      <div className="grid grid-cols-2 gap-4 h-full">
                        {/* Ours */}
                        <Paper className="flex flex-col overflow-hidden" radius="md" withBorder>
                          <Group
                            justify="space-between"
                            className="border-b bg-blue-500/10 px-3 py-2"
                          >
                            <Group gap="xs">
                              <ArrowLeft className="h-4 w-4" />
                              <Text size="sm" fw={500}>
                                Ours (Current)
                              </Text>
                            </Group>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleResolve('ours')}
                              disabled={resolveConflict.isPending}
                              leftSection={
                                resolveConflict.isPending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                )
                              }
                            >
                              Accept Ours
                            </Button>
                          </Group>
                          <ScrollArea className="flex-1">
                            <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                              {fileConflict.oursContent || '(empty)'}
                            </pre>
                          </ScrollArea>
                        </Paper>

                        {/* Theirs */}
                        <Paper className="flex flex-col overflow-hidden" radius="md" withBorder>
                          <Group
                            justify="space-between"
                            className="border-b bg-green-500/10 px-3 py-2"
                          >
                            <Group gap="xs">
                              <ArrowRight className="h-4 w-4" />
                              <Text size="sm" fw={500}>
                                Theirs (Incoming)
                              </Text>
                            </Group>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => handleResolve('theirs')}
                              disabled={resolveConflict.isPending}
                              leftSection={
                                resolveConflict.isPending ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Check className="h-3 w-3" />
                                )
                              }
                            >
                              Accept Theirs
                            </Button>
                          </Group>
                          <ScrollArea className="flex-1">
                            <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                              {fileConflict.theirsContent || '(empty)'}
                            </pre>
                          </ScrollArea>
                        </Paper>
                      </div>
                    </Tabs.Panel>

                    {/* Manual edit view */}
                    <Tabs.Panel
                      value="manual"
                      className="flex-1 overflow-hidden m-0 p-4 flex flex-col"
                    >
                      <Paper
                        className="flex flex-1 flex-col overflow-hidden"
                        radius="md"
                        withBorder
                      >
                        <Group justify="space-between" className="border-b bg-muted/50 px-3 py-2">
                          <Text size="sm" fw={500}>
                            Manual Resolution
                          </Text>
                          <Button
                            size="xs"
                            onClick={() => handleResolve('manual')}
                            disabled={resolveConflict.isPending}
                            leftSection={
                              resolveConflict.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )
                            }
                          >
                            Save Resolution
                          </Button>
                        </Group>
                        <Textarea
                          value={manualContent}
                          onChange={(e) => setManualContent(e.currentTarget.value)}
                          className="flex-1 font-mono text-xs resize-none border-0 rounded-none focus-visible:ring-0"
                          placeholder="Edit the file content to resolve conflicts..."
                        />
                      </Paper>
                    </Tabs.Panel>
                  </Tabs>
                </>
              ) : fileLoading ? (
                <Stack align="center" justify="center" className="flex-1">
                  <Loader color="gray" size="md" />
                </Stack>
              ) : (
                <Text className="flex flex-1 items-center justify-center" c="dimmed">
                  Select a file to resolve conflicts
                </Text>
              )}
            </div>
          </div>
        </Stack>
      </Drawer>

      {/* Abort confirmation dialog */}
      <Modal
        opened={showAbortDialog}
        onClose={() => setShowAbortDialog(false)}
        title={`Abort ${status?.rebaseInProgress ? 'Rebase' : 'Merge'}?`}
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will discard all conflict resolutions and return to the state before the
            {status?.rebaseInProgress ? ' rebase' : ' merge'} started.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setShowAbortDialog(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void handleAbort();
              }}
              leftSection={
                abortConflict.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined
              }
            >
              Abort
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
