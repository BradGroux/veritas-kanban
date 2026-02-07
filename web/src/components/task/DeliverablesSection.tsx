import { useState } from 'react';
import { FileText, Pencil, Trash2, X, Check, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  useAddDeliverable,
  useUpdateDeliverable,
  useDeleteDeliverable,
} from '@/hooks/useDeliverables';
import type { Task, Deliverable, DeliverableType, DeliverableStatus } from '@veritas-kanban/shared';

interface DeliverablesSectionProps {
  task: Task;
}

const TYPE_COLORS: Record<DeliverableType, string> = {
  document: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  code: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  report: 'bg-green-500/10 text-green-700 dark:text-green-400',
  artifact: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  other: 'bg-gray-500/10 text-gray-700 dark:text-gray-400',
};

const STATUS_COLORS: Record<DeliverableStatus, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  attached: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  reviewed: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  accepted: 'bg-green-500/10 text-green-700 dark:text-green-400',
};

function DeliverableItem({ deliverable, taskId }: { deliverable: Deliverable; taskId: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(deliverable.title);
  const [editType, setEditType] = useState<DeliverableType>(deliverable.type);
  const [editPath, setEditPath] = useState(deliverable.path || '');
  const [editStatus, setEditStatus] = useState<DeliverableStatus>(deliverable.status);
  const [editDescription, setEditDescription] = useState(deliverable.description || '');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateDeliverable = useUpdateDeliverable();
  const deleteDeliverable = useDeleteDeliverable();

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) return;
    await updateDeliverable.mutateAsync({
      taskId,
      deliverableId: deliverable.id,
      title: editTitle.trim(),
      type: editType,
      path: editPath.trim() || undefined,
      status: editStatus,
      description: editDescription.trim() || undefined,
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditTitle(deliverable.title);
    setEditType(deliverable.type);
    setEditPath(deliverable.path || '');
    setEditStatus(deliverable.status);
    setEditDescription(deliverable.description || '');
    setIsEditing(false);
  };

  const handleDelete = async () => {
    await deleteDeliverable.mutateAsync({ taskId, deliverableId: deliverable.id });
    setDeleteDialogOpen(false);
  };

  const isUrl = deliverable.path && /^https?:\/\//i.test(deliverable.path);

  return (
    <>
      <div className="group flex gap-3 p-3 rounded-md bg-muted/30 border border-border/50">
        <div className="h-8 w-8 flex-shrink-0 rounded-md bg-primary/10 flex items-center justify-center">
          <FileText className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Title</Label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Deliverable title"
                  className="text-sm h-8"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select value={editType} onValueChange={(v) => setEditType(v as DeliverableType)}>
                    <SelectTrigger className="text-sm h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="document">Document</SelectItem>
                      <SelectItem value="code">Code</SelectItem>
                      <SelectItem value="report">Report</SelectItem>
                      <SelectItem value="artifact">Artifact</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={editStatus}
                    onValueChange={(v) => setEditStatus(v as DeliverableStatus)}
                  >
                    <SelectTrigger className="text-sm h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="attached">Attached</SelectItem>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Path / URL (optional)</Label>
                <Input
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  placeholder="https://... or /path/to/file"
                  className="text-sm h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Description (optional)</Label>
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Add details about this deliverable..."
                  className="text-sm min-h-[60px] resize-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-7"
                  onClick={handleSaveEdit}
                  disabled={!editTitle.trim() || updateDeliverable.isPending}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Save
                </Button>
                <Button variant="ghost" size="sm" className="h-7" onClick={handleCancelEdit}>
                  <X className="h-3 w-3 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2 mb-1">
                <span className="font-medium text-sm flex-1">{deliverable.title}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label="Edit deliverable"
                    onClick={() => setIsEditing(true)}
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label="Delete deliverable"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[deliverable.type]}`}
                >
                  {deliverable.type}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[deliverable.status]}`}
                >
                  {deliverable.status}
                </span>
                {deliverable.agent && (
                  <span className="text-xs text-muted-foreground">by {deliverable.agent}</span>
                )}
              </div>
              {deliverable.path && (
                <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  {isUrl ? (
                    <a
                      href={deliverable.path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-1"
                    >
                      {deliverable.path}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="font-mono">{deliverable.path}</span>
                  )}
                </div>
              )}
              {deliverable.description && (
                <p className="text-xs text-foreground/70 mt-1">{deliverable.description}</p>
              )}
              <div className="text-xs text-muted-foreground mt-1">
                Added {new Date(deliverable.created).toLocaleDateString()}
              </div>
            </>
          )}
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete deliverable?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deliverable.title}" from this task's deliverables?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function DeliverablesSection({ task }: DeliverablesSectionProps) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DeliverableType>('document');
  const [path, setPath] = useState('');
  const [description, setDescription] = useState('');

  const addDeliverable = useAddDeliverable();

  const deliverables = task.deliverables || [];

  const handleAddDeliverable = async () => {
    if (!title.trim()) return;
    await addDeliverable.mutateAsync({
      taskId: task.id,
      title: title.trim(),
      type,
      path: path.trim() || undefined,
      description: description.trim() || undefined,
    });
    setTitle('');
    setType('document');
    setPath('');
    setDescription('');
    setShowForm(false);
  };

  const handleCancel = () => {
    setTitle('');
    setType('document');
    setPath('');
    setDescription('');
    setShowForm(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <Label className="text-sm font-medium">
            Deliverables {deliverables.length > 0 && `(${deliverables.length})`}
          </Label>
        </div>
        {!showForm && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowForm(true)}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        )}
      </div>

      {deliverables.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">No deliverables yet</p>
      )}

      {showForm && (
        <div className="space-y-3 p-3 rounded-md border border-border bg-muted/20">
          <div>
            <Label className="text-xs">Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., API Documentation"
              className="text-sm h-8"
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs">Type *</Label>
            <Select value={type} onValueChange={(v) => setType(v as DeliverableType)}>
              <SelectTrigger className="text-sm h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="document">Document</SelectItem>
                <SelectItem value="code">Code</SelectItem>
                <SelectItem value="report">Report</SelectItem>
                <SelectItem value="artifact">Artifact</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Path / URL (optional)</Label>
            <Input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="https://... or /path/to/file"
              className="text-sm h-8"
            />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add details about this deliverable..."
              className="text-sm min-h-[60px] resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleAddDeliverable}
              disabled={!title.trim() || addDeliverable.isPending}
            >
              <Check className="h-3 w-3 mr-1" />
              Add Deliverable
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {deliverables.map((deliverable) => (
          <DeliverableItem key={deliverable.id} deliverable={deliverable} taskId={task.id} />
        ))}
      </div>
    </div>
  );
}
