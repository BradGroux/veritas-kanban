import { useState } from 'react';
import { Plus, Trash2, ShieldCheck, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  useAddVerificationStep,
  useUpdateVerificationStep,
  useDeleteVerificationStep,
} from '@/hooks/useTasks';
import { cn } from '@/lib/utils';
import type { Task, VerificationStep } from '@veritas-kanban/shared';

interface VerificationSectionProps {
  task: Task;
}

export function VerificationSection({ task }: VerificationSectionProps) {
  const [newDescription, setNewDescription] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const addStep = useAddVerificationStep();
  const updateStep = useUpdateVerificationStep();
  const deleteStep = useDeleteVerificationStep();

  const steps = task.verificationSteps || [];
  const checkedCount = steps.filter((s) => s.checked).length;
  const totalCount = steps.length;
  const progress = totalCount > 0 ? (checkedCount / totalCount) * 100 : 0;

  const handleAddStep = async () => {
    if (!newDescription.trim()) return;

    setIsAdding(true);
    try {
      await addStep.mutateAsync({ taskId: task.id, description: newDescription.trim() });
      setNewDescription('');
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggleStep = async (step: VerificationStep) => {
    await updateStep.mutateAsync({
      taskId: task.id,
      stepId: step.id,
      updates: { checked: !step.checked },
    });
  };

  const handleDeleteStep = async (stepId: string) => {
    await deleteStep.mutateAsync({ taskId: task.id, stepId });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAddStep();
    }
  };

  const formatTimestamp = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          <Label className="text-muted-foreground">Done Criteria</Label>
        </div>
        {totalCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {checkedCount}/{totalCount} verified
          </span>
        )}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300',
              checkedCount === totalCount ? 'bg-green-500' : 'bg-primary'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Verification step list */}
      <div className="space-y-1">
        {steps.map((step) => (
          <div
            key={step.id}
            className={cn(
              'flex items-start gap-2 p-2 rounded-md group hover:bg-muted/50 transition-colors',
              step.checked && 'opacity-70'
            )}
          >
            <Checkbox
              checked={step.checked}
              onCheckedChange={() => handleToggleStep(step)}
              className={cn(
                'flex-shrink-0 mt-0.5',
                step.checked &&
                  'data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600'
              )}
            />
            <div className="flex-1 min-w-0">
              <span className={cn('text-sm', step.checked && 'line-through text-muted-foreground')}>
                {step.description}
              </span>
              {step.checked && step.checkedAt && (
                <div className="flex items-center gap-1 mt-0.5">
                  <Check className="h-3 w-3 text-green-500" />
                  <span className="text-xs text-green-500/80">
                    {formatTimestamp(step.checkedAt)}
                  </span>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onClick={() => handleDeleteStep(step.id)}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      {/* Add verification step input */}
      <div className="flex gap-2">
        <Input
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add verification step..."
          className="text-sm"
          disabled={isAdding}
        />
        <Button
          size="icon"
          onClick={handleAddStep}
          disabled={!newDescription.trim() || isAdding}
          className="h-9 w-9 shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
