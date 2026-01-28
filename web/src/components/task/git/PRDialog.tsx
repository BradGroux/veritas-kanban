import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
      window.open(result.url, '_blank');
    } catch {
      // Intentionally silent: error is handled by the mutation's onError callback
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Pull Request</DialogTitle>
          <DialogDescription>
            Create a PR from {task.git?.branch} to {task.git?.baseBranch}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="pr-title">Title</Label>
            <Input
              id="pr-title"
              value={prTitle}
              onChange={(e) => setPrTitle(e.target.value)}
              placeholder="PR title"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pr-body">Description</Label>
            <Textarea
              id="pr-body"
              value={prBody}
              onChange={(e) => setPrBody(e.target.value)}
              placeholder="Describe your changes..."
              rows={5}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="pr-draft"
              checked={prDraft}
              onCheckedChange={(checked) => setPrDraft(checked === true)}
            />
            <Label htmlFor="pr-draft" className="text-sm font-normal">
              Create as draft PR
            </Label>
          </div>
          {createPR.error && (
            <p className="text-sm text-red-500">{(createPR.error as Error).message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreatePR} disabled={createPR.isPending || !prTitle}>
            {createPR.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <GitPullRequest className="h-4 w-4 mr-2" />
                Create PR
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
