import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Download, Loader2 } from 'lucide-react';

export type ExportScope = 'full' | 'project' | 'task';
export type ExportFormat = 'csv' | 'json';

interface ProjectOption {
  id: string;
  label: string;
}

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill the task ID when exporting from task context */
  taskId?: string;
  /** Pre-fill the project when exporting from project context */
  project?: string;
  /** Available projects for the dropdown */
  projects?: ProjectOption[];
}

export function ExportDialog({
  open,
  onOpenChange,
  taskId: initialTaskId,
  project: initialProject,
  projects = [],
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [scope, setScope] = useState<ExportScope>(
    initialTaskId ? 'task' : initialProject ? 'project' : 'full'
  );
  const [taskId, setTaskId] = useState(initialTaskId || '');
  const [project, setProject] = useState(initialProject || '');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    
    try {
      // Build query params
      const params = new URLSearchParams();
      params.set('format', format);
      
      if (scope === 'task' && taskId) {
        params.set('taskId', taskId);
      } else if (scope === 'project' && project) {
        params.set('project', project);
      }
      
      if (fromDate) {
        params.set('from', new Date(fromDate).toISOString());
      }
      if (toDate) {
        // Set to end of day
        const toDateTime = new Date(toDate);
        toDateTime.setHours(23, 59, 59, 999);
        params.set('to', toDateTime.toISOString());
      }
      
      // Fetch the export
      const response = await fetch(`/api/telemetry/export?${params}`);
      
      if (!response.ok) {
        throw new Error('Export failed');
      }
      
      // Get filename from Content-Disposition header or generate one
      const disposition = response.headers.get('Content-Disposition');
      let filename = `telemetry-export.${format}`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = match[1];
        }
      }
      
      // Create blob and download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      onOpenChange(false);
    } catch (error) {
      console.error('Export error:', error);
      // Could add toast notification here
    } finally {
      setIsExporting(false);
    }
  };

  // Reset form when dialog opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setFormat('csv');
      setScope(initialTaskId ? 'task' : initialProject ? 'project' : 'full');
      setTaskId(initialTaskId || '');
      setProject(initialProject || '');
      setFromDate('');
      setToDate('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export Metrics
          </DialogTitle>
          <DialogDescription>
            Export telemetry data as CSV or JSON for reporting and analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Format Selection */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="format" className="text-right">
              Format
            </Label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV (Spreadsheets)</SelectItem>
                <SelectItem value="json">JSON (Programmatic)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Scope Selection */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="scope" className="text-right">
              Scope
            </Label>
            <Select value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">All Data</SelectItem>
                <SelectItem value="project">By Project</SelectItem>
                <SelectItem value="task">By Task</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Project Selection (conditional) */}
          {scope === 'project' && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="project" className="text-right">
                Project
              </Label>
              {projects.length > 0 ? (
                <Select value={project} onValueChange={setProject}>
                  <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select project..." />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="project"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="Project name"
                  className="col-span-3"
                />
              )}
            </div>
          )}

          {/* Task ID (conditional) */}
          {scope === 'task' && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="taskId" className="text-right">
                Task ID
              </Label>
              <Input
                id="taskId"
                value={taskId}
                onChange={(e) => setTaskId(e.target.value)}
                placeholder="task_..."
                className="col-span-3"
              />
            </div>
          )}

          {/* Date Range */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="from" className="text-right">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="col-span-3"
            />
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="to" className="text-right">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="col-span-3"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleExport} 
            disabled={isExporting || (scope === 'task' && !taskId) || (scope === 'project' && !project)}
          >
            {isExporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
