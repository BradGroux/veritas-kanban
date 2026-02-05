import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
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
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[90vw] sm:max-w-[1200px] p-0 flex flex-col">
          <SheetHeader className="px-6 py-4 border-b">
            <div className="flex items-center justify-between pr-8">
              <div>
                <SheetTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Merge Conflicts
                </SheetTitle>
                <SheetDescription>
                  {status?.rebaseInProgress ? 'Rebase' : 'Merge'} has conflicts that need to be
                  resolved
                </SheetDescription>
              </div>

              <div className="flex items-center gap-2">
                {status?.conflictingFiles.length === 0 && (
                  <Button onClick={handleContinue} disabled={continueConflict.isPending}>
                    {continueConflict.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <GitMerge className="h-4 w-4 mr-2" />
                    )}
                    Continue {status?.rebaseInProgress ? 'Rebase' : 'Merge'}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setShowAbortDialog(true)}>
                  <X className="h-4 w-4 mr-2" />
                  Abort
                </Button>
              </div>
            </div>
          </SheetHeader>

          <div className="flex flex-1 overflow-hidden">
            {/* File list sidebar */}
            <div className="w-64 border-r flex flex-col">
              <div className="p-3 border-b bg-muted/50">
                <h3 className="text-sm font-medium">
                  Conflicting Files ({status?.conflictingFiles.length || 0})
                </h3>
              </div>
              <ScrollArea className="flex-1">
                {statusLoading ? (
                  <div className="p-4 text-center text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                    Loading...
                  </div>
                ) : status?.conflictingFiles.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground">
                    <Check className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    All conflicts resolved!
                  </div>
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
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateFile('prev')}
                        disabled={!status?.conflictingFiles.length}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm">
                        {currentIndex + 1} of {status?.conflictingFiles.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateFile('next')}
                        disabled={!status?.conflictingFiles.length}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <code className="text-sm bg-muted px-2 py-1 rounded">{selectedFile}</code>
                  </div>

                  {/* Conflict viewer tabs */}
                  <Tabs defaultValue="sidebyside" className="flex-1 flex flex-col overflow-hidden">
                    <TabsList className="mx-4 mt-2 w-fit">
                      <TabsTrigger value="sidebyside">Side by Side</TabsTrigger>
                      <TabsTrigger value="manual">Manual Edit</TabsTrigger>
                    </TabsList>

                    {/* Side by side view */}
                    <TabsContent value="sidebyside" className="flex-1 overflow-hidden m-0 p-4">
                      <div className="grid grid-cols-2 gap-4 h-full">
                        {/* Ours */}
                        <div className="flex flex-col border rounded-lg overflow-hidden">
                          <div className="px-3 py-2 bg-blue-500/10 border-b flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                              <ArrowLeft className="h-4 w-4" />
                              Ours (Current)
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResolve('ours')}
                              disabled={resolveConflict.isPending}
                            >
                              {resolveConflict.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <Check className="h-3 w-3 mr-1" />
                                  Accept Ours
                                </>
                              )}
                            </Button>
                          </div>
                          <ScrollArea className="flex-1">
                            <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                              {fileConflict.oursContent || '(empty)'}
                            </pre>
                          </ScrollArea>
                        </div>

                        {/* Theirs */}
                        <div className="flex flex-col border rounded-lg overflow-hidden">
                          <div className="px-3 py-2 bg-green-500/10 border-b flex items-center justify-between">
                            <span className="text-sm font-medium flex items-center gap-2">
                              <ArrowRight className="h-4 w-4" />
                              Theirs (Incoming)
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleResolve('theirs')}
                              disabled={resolveConflict.isPending}
                            >
                              {resolveConflict.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <>
                                  <Check className="h-3 w-3 mr-1" />
                                  Accept Theirs
                                </>
                              )}
                            </Button>
                          </div>
                          <ScrollArea className="flex-1">
                            <pre className="p-3 text-xs font-mono whitespace-pre-wrap">
                              {fileConflict.theirsContent || '(empty)'}
                            </pre>
                          </ScrollArea>
                        </div>
                      </div>
                    </TabsContent>

                    {/* Manual edit view */}
                    <TabsContent
                      value="manual"
                      className="flex-1 overflow-hidden m-0 p-4 flex flex-col"
                    >
                      <div className="flex-1 flex flex-col border rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-muted/50 border-b flex items-center justify-between">
                          <span className="text-sm font-medium">Manual Resolution</span>
                          <Button
                            size="sm"
                            onClick={() => handleResolve('manual')}
                            disabled={resolveConflict.isPending}
                          >
                            {resolveConflict.isPending ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4 mr-2" />
                            )}
                            Save Resolution
                          </Button>
                        </div>
                        <Textarea
                          value={manualContent}
                          onChange={(e) => setManualContent(e.target.value)}
                          className="flex-1 font-mono text-xs resize-none border-0 rounded-none focus-visible:ring-0"
                          placeholder="Edit the file content to resolve conflicts..."
                        />
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              ) : fileLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-muted-foreground">
                  Select a file to resolve conflicts
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Abort confirmation dialog */}
      <AlertDialog open={showAbortDialog} onOpenChange={setShowAbortDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Abort {status?.rebaseInProgress ? 'Rebase' : 'Merge'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will discard all conflict resolutions and return to the state before the
              {status?.rebaseInProgress ? ' rebase' : ' merge'} started.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAbort}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {abortConflict.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Abort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
