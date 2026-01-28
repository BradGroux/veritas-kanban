import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Ban, MessageSquare, Wrench, Link2, HelpCircle } from 'lucide-react';
import type { Task, BlockedCategory, BlockedReason } from '@veritas-kanban/shared';
import { sanitizeText } from '@/lib/sanitize';

interface BlockedReasonSectionProps {
  task: Task;
  onUpdate: (blockedReason: BlockedReason | undefined) => void;
  readOnly?: boolean;
}

const BLOCKED_CATEGORIES: { value: BlockedCategory; label: string; icon: React.ReactNode; description: string }[] = [
  { 
    value: 'waiting-on-feedback', 
    label: 'Waiting on Feedback', 
    icon: <MessageSquare className="h-4 w-4" />,
    description: 'Blocked waiting for input from someone',
  },
  { 
    value: 'technical-snag', 
    label: 'Technical Snag', 
    icon: <Wrench className="h-4 w-4" />,
    description: 'Blocked by a technical issue or bug',
  },
  { 
    value: 'prerequisite', 
    label: 'Prerequisite', 
    icon: <Link2 className="h-4 w-4" />,
    description: 'Blocked by another task that must complete first',
  },
  { 
    value: 'other', 
    label: 'Other', 
    icon: <HelpCircle className="h-4 w-4" />,
    description: 'Blocked for another reason',
  },
];

export function BlockedReasonSection({ task, onUpdate, readOnly = false }: BlockedReasonSectionProps) {
  // Only show when status is blocked
  if (task.status !== 'blocked') {
    return null;
  }

  const currentCategory = task.blockedReason?.category;
  const currentNote = task.blockedReason?.note || '';

  const handleCategoryChange = (value: BlockedCategory) => {
    onUpdate({
      category: value,
      note: currentNote || undefined,
    });
  };

  const handleNoteChange = (note: string) => {
    if (!currentCategory) {
      // If no category selected, default to 'other'
      onUpdate({
        category: 'other',
        note: note || undefined,
      });
    } else {
      onUpdate({
        category: currentCategory,
        note: note || undefined,
      });
    }
  };

  const getCategoryInfo = (category: BlockedCategory) => {
    return BLOCKED_CATEGORIES.find(c => c.value === category);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Ban className="h-4 w-4 text-red-500" />
        <Label className="text-muted-foreground font-medium">Blocked Reason</Label>
      </div>

      {readOnly ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 space-y-2">
          {currentCategory ? (
            <>
              <div className="flex items-center gap-2 text-red-400">
                {getCategoryInfo(currentCategory)?.icon}
                <span className="font-medium">{getCategoryInfo(currentCategory)?.label}</span>
              </div>
              {currentNote && (
                <p className="text-sm text-muted-foreground">{sanitizeText(currentNote)}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No reason specified</p>
          )}
        </div>
      ) : (
        <>
          <Select
            value={currentCategory || ''}
            onValueChange={(value) => handleCategoryChange(value as BlockedCategory)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Why is this task blocked?" />
            </SelectTrigger>
            <SelectContent>
              {BLOCKED_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  <div className="flex items-center gap-2">
                    {cat.icon}
                    <span>{cat.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Textarea
            value={currentNote}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="Add details about what's blocking this task..."
            rows={2}
            className="resize-none text-sm"
          />

          {currentCategory && (
            <p className="text-xs text-muted-foreground">
              {getCategoryInfo(currentCategory)?.description}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export { BLOCKED_CATEGORIES };
