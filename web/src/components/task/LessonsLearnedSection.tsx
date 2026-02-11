import { useState, useCallback, useRef, useEffect } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Lightbulb, X, Plus } from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';

interface LessonsLearnedSectionProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  readOnly?: boolean;
}

/**
 * Section for capturing lessons learned after task completion.
 * Only displayed when task status is 'done'.
 */
export function LessonsLearnedSection({
  task,
  onUpdate,
  readOnly = false,
}: LessonsLearnedSectionProps) {
  const [newTag, setNewTag] = useState('');
  const [localNotes, setLocalNotes] = useState(task.lessonsLearned || '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when task changes externally
  useEffect(() => {
    setLocalNotes(task.lessonsLearned || '');
  }, [task.lessonsLearned]);

  const debouncedUpdate = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onUpdate('lessonsLearned', value);
      }, 500);
    },
    [onUpdate]
  );

  // Only show for completed tasks
  if (task.status !== 'done') {
    return null;
  }

  const tags = task.lessonTags || [];

  const handleAddTag = () => {
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onUpdate('lessonTags', [...tags, trimmed]);
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdate(
      'lessonTags',
      tags.filter((t) => t !== tagToRemove)
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted p-4">
      <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
        <Lightbulb className="h-5 w-5" />
        <h3 className="font-semibold">Lessons Learned</h3>
      </div>

      <p className="text-sm text-muted-foreground">
        Capture institutional knowledge from this completed task. What worked well? What would you
        do differently?
      </p>

      <div className="space-y-2">
        <Label htmlFor="lessonsLearned">Notes (Markdown supported)</Label>
        {readOnly ? (
          <div className="prose prose-sm dark:prose-invert max-w-none p-3 bg-card rounded border border-border">
            {task.lessonsLearned || (
              <span className="text-muted-foreground italic">No lessons captured</span>
            )}
          </div>
        ) : (
          <Textarea
            id="lessonsLearned"
            value={localNotes}
            onChange={(e) => {
              setLocalNotes(e.target.value);
              debouncedUpdate(e.target.value);
            }}
            placeholder="What did you learn from this task? What would you do differently next time?"
            className="min-h-[120px] bg-card border-border"
          />
        )}
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="ml-1 hover:text-destructive"
                  aria-label={`Remove ${tag} tag`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {tags.length === 0 && (
            <span className="text-sm text-muted-foreground italic">No tags added</span>
          )}
        </div>

        {!readOnly && (
          <div className="flex gap-2">
            <Input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add a tag..."
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddTag}
              disabled={!newTag.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
