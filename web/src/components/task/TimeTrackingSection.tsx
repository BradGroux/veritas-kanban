import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  useStartTimer, 
  useStopTimer, 
  useAddTimeEntry, 
  useDeleteTimeEntry,
  formatDuration,
  parseDuration,
} from '@/hooks/useTimeTracking';
import { 
  Play, 
  Square, 
  Plus, 
  Trash2, 
  Clock, 
  Loader2,
  Timer,
} from 'lucide-react';
import type { Task, TimeEntry } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';
import { sanitizeText } from '@/lib/sanitize';

interface TimeTrackingSectionProps {
  task: Task;
}

function RunningTimer({ startTime }: { startTime: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    
    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    };
    
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    
    return () => clearInterval(interval);
  }, [startTime]);

  return (
    <span className="font-mono tabular-nums text-green-600 dark:text-green-400">
      {formatDuration(elapsed)}
    </span>
  );
}

export function TimeTrackingSection({ task }: TimeTrackingSectionProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [durationInput, setDurationInput] = useState('');
  const [descriptionInput, setDescriptionInput] = useState('');
  
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const addTimeEntry = useAddTimeEntry();
  const deleteTimeEntry = useDeleteTimeEntry();

  const isRunning = task.timeTracking?.isRunning || false;
  const totalSeconds = task.timeTracking?.totalSeconds || 0;
  const entries = task.timeTracking?.entries || [];
  const activeEntry = entries.find(e => e.id === task.timeTracking?.activeEntryId);

  const handleStartStop = async () => {
    if (isRunning) {
      await stopTimer.mutateAsync(task.id);
    } else {
      await startTimer.mutateAsync(task.id);
    }
  };

  const handleAddEntry = async () => {
    const seconds = parseDuration(durationInput);
    if (!seconds) return;
    
    await addTimeEntry.mutateAsync({
      taskId: task.id,
      duration: seconds,
      description: descriptionInput || undefined,
    });
    
    setDurationInput('');
    setDescriptionInput('');
    setAddDialogOpen(false);
  };

  const handleDeleteEntry = async (entryId: string) => {
    await deleteTimeEntry.mutateAsync({ taskId: task.id, entryId });
  };

  const formatEntryTime = (entry: TimeEntry) => {
    const date = new Date(entry.startTime);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Time Tracking
        </Label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            Total: {formatDuration(totalSeconds)}
          </span>
        </div>
      </div>

      <div className="p-4 rounded-lg border bg-muted/30 space-y-4">
        {/* Timer controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant={isRunning ? 'destructive' : 'default'}
              size="sm"
              onClick={handleStartStop}
              disabled={startTimer.isPending || stopTimer.isPending}
            >
              {startTimer.isPending || stopTimer.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRunning ? (
                <>
                  <Square className="h-4 w-4 mr-2" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start
                </>
              )}
            </Button>
            
            {isRunning && activeEntry && (
              <div className="flex items-center gap-2">
                <Timer className="h-4 w-4 text-green-500 animate-pulse" />
                <RunningTimer startTime={activeEntry.startTime} />
              </div>
            )}
          </div>

          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Time
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Time Entry</DialogTitle>
                <DialogDescription>
                  Manually add time spent on this task.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="duration">Duration</Label>
                  <Input
                    id="duration"
                    value={durationInput}
                    onChange={(e) => setDurationInput(e.target.value)}
                    placeholder="e.g., 1h 30m or 45m or 30"
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter as "1h 30m", "45m", or just minutes (e.g., "30")
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Input
                    id="description"
                    value={descriptionInput}
                    onChange={(e) => setDescriptionInput(e.target.value)}
                    placeholder="What did you work on?"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleAddEntry}
                  disabled={!parseDuration(durationInput) || addTimeEntry.isPending}
                >
                  {addTimeEntry.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add Entry
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Time entries list */}
        {entries.length > 0 && (
          <div className="border-t pt-3">
            <Label className="text-xs text-muted-foreground mb-2 block">
              Time Entries ({entries.length})
            </Label>
            <ScrollArea className="max-h-48">
              <div className="space-y-2">
                {entries.slice().reverse().map((entry) => (
                  <div
                    key={entry.id}
                    className={cn(
                      "flex items-center justify-between p-2 rounded text-sm",
                      entry.id === task.timeTracking?.activeEntryId
                        ? "bg-green-500/10 border border-green-500/20"
                        : "bg-muted/50"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {entry.id === task.timeTracking?.activeEntryId ? (
                          <Timer className="h-3 w-3 text-green-500 animate-pulse flex-shrink-0" />
                        ) : (
                          <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        )}
                        <span className="font-medium">
                          {entry.duration ? formatDuration(entry.duration) : (
                            <RunningTimer startTime={entry.startTime} />
                          )}
                        </span>
                        {entry.manual && (
                          <span className="text-xs text-muted-foreground">(manual)</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground pl-5 truncate">
                        {entry.description ? sanitizeText(entry.description) : formatEntryTime(entry)}
                      </div>
                    </div>
                    {entry.id !== task.timeTracking?.activeEntryId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteEntry(entry.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
