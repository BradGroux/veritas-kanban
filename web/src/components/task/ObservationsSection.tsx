import { useState } from 'react';
import { Eye, Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import type { Task, Observation, ObservationType } from '@veritas-kanban/shared';

interface ObservationsSectionProps {
  task: Task;
  onAddObservation: (data: {
    type: ObservationType;
    content: string;
    score: number;
    agent?: string;
  }) => Promise<void>;
  onDeleteObservation: (observationId: string) => Promise<void>;
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

const TYPE_COLORS: Record<ObservationType, string> = {
  decision: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  blocker: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  insight: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  context: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

function ObservationItem({
  observation,
  taskId,
  onDelete,
}: {
  observation: Observation;
  taskId: string;
  onDelete: (observationId: string) => Promise<void>;
}) {
  void taskId;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const handleDelete = async () => {
    await onDelete(observation.id);
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <div className="group flex gap-3 p-3 rounded-md border bg-card hover:bg-muted/30 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[observation.type]}`}
            >
              {observation.type}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              Score: {observation.score}/10
            </span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(observation.timestamp)}
            </span>
            {observation.agent && (
              <span className="text-xs text-muted-foreground">by {observation.agent}</span>
            )}
            {/* Delete button - visible on hover */}
            <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                aria-label="Delete observation"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2
                  className="h-3 w-3 text-muted-foreground hover:text-destructive"
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{observation.content}</p>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Observation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this observation? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function ObservationsSection({
  task,
  onAddObservation,
  onDeleteObservation,
}: ObservationsSectionProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newObsType, setNewObsType] = useState<ObservationType>('context');
  const [newObsContent, setNewObsContent] = useState('');
  const [newObsScore, setNewObsScore] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const observations = task.observations || [];

  const handleAdd = async () => {
    if (!newObsContent.trim()) return;

    setIsSubmitting(true);
    try {
      await onAddObservation({
        type: newObsType,
        content: newObsContent.trim(),
        score: newObsScore,
      });
      setNewObsContent('');
      setNewObsScore(5);
      setNewObsType('context');
      setIsAdding(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-lg font-semibold">Observations</h3>
          <span className="text-sm text-muted-foreground">({observations.length})</span>
        </div>
        {!isAdding && (
          <Button variant="outline" size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
            Add Observation
          </Button>
        )}
      </div>

      {isAdding && (
        <div className="border rounded-lg p-4 bg-card space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="obs-type">Type</Label>
              <Select value={newObsType} onValueChange={(v) => setNewObsType(v as ObservationType)}>
                <SelectTrigger id="obs-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="context">Context</SelectItem>
                  <SelectItem value="decision">Decision</SelectItem>
                  <SelectItem value="insight">Insight</SelectItem>
                  <SelectItem value="blocker">Blocker</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="obs-score">Importance: {newObsScore}/10</Label>
              <input
                type="range"
                id="obs-score"
                min="1"
                max="10"
                value={newObsScore}
                onChange={(e) => setNewObsScore(parseInt(e.target.value))}
                className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                aria-label={`Importance score: ${newObsScore} out of 10`}
                aria-valuenow={newObsScore}
                aria-valuemin={1}
                aria-valuemax={10}
                aria-valuetext={`${newObsScore} out of 10`}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="obs-content">Content</Label>
            <Textarea
              id="obs-content"
              value={newObsContent}
              onChange={(e) => setNewObsContent(e.target.value)}
              placeholder="Record a decision, blocker, insight, or context..."
              className="min-h-[100px] resize-none"
              autoFocus
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsAdding(false);
                setNewObsContent('');
                setNewObsScore(5);
                setNewObsType('context');
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={!newObsContent.trim() || isSubmitting}>
              {isSubmitting ? 'Adding...' : 'Add Observation'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {observations.length === 0 && !isAdding && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No observations yet. Add context, decisions, insights, or blockers as you work on this
            task.
          </p>
        )}
        {observations
          .slice()
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .map((obs) => (
            <ObservationItem
              key={obs.id}
              observation={obs}
              taskId={task.id}
              onDelete={onDeleteObservation}
            />
          ))}
      </div>
    </div>
  );
}
