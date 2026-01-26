import { useState } from 'react';
import { useDiffSummary, useFileDiff } from '@/hooks/useDiff';
import {
  FileCode,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronRight,
  Loader2,
  AlertCircle,
  Plus,
} from 'lucide-react';
import type { Task } from '@veritas-kanban/shared';
import type { FileChange, DiffLine, DiffHunk } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DiffViewerProps {
  task: Task;
  onAddComment?: (filePath: string, lineNumber: number) => void;
}

const statusIcons: Record<FileChange['status'], React.ReactNode> = {
  added: <FilePlus className="h-4 w-4 text-green-500" />,
  modified: <FileEdit className="h-4 w-4 text-amber-500" />,
  deleted: <FileMinus className="h-4 w-4 text-red-500" />,
  renamed: <FileCode className="h-4 w-4 text-blue-500" />,
};

function FileTree({
  files,
  selectedFile,
  onSelectFile,
}: {
  files: FileChange[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="space-y-1">
      {files.map((file) => (
        <button
          key={file.path}
          onClick={() => onSelectFile(file.path)}
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md text-left',
            'hover:bg-muted transition-colors',
            selectedFile === file.path && 'bg-muted'
          )}
        >
          {statusIcons[file.status]}
          <span className="truncate flex-1 font-mono text-xs">{file.path}</span>
          <span className="flex items-center gap-1 text-xs">
            {file.additions > 0 && (
              <span className="text-green-500">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="text-red-500">-{file.deletions}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

function DiffHunkView({
  hunk,
  filePath,
  onAddComment,
}: {
  hunk: DiffHunk;
  filePath: string;
  onAddComment?: (filePath: string, lineNumber: number) => void;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      {/* Hunk header */}
      <div className="bg-muted/50 px-4 py-1 text-xs text-muted-foreground font-mono">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      
      {/* Lines */}
      <div className="font-mono text-xs">
        {hunk.lines.map((line, idx) => (
          <DiffLineView
            key={idx}
            line={line}
            filePath={filePath}
            onAddComment={onAddComment}
          />
        ))}
      </div>
    </div>
  );
}

function DiffLineView({
  line,
  filePath,
  onAddComment,
}: {
  line: DiffLine;
  filePath: string;
  onAddComment?: (filePath: string, lineNumber: number) => void;
}) {
  const lineNumber = line.newNumber || line.oldNumber;
  
  return (
    <div
      className={cn(
        'group flex hover:bg-muted/30',
        line.type === 'add' && 'bg-green-500/10',
        line.type === 'delete' && 'bg-red-500/10'
      )}
    >
      {/* Line numbers */}
      <div className="flex-shrink-0 w-20 flex text-muted-foreground select-none border-r border-border">
        <span className="w-10 px-2 text-right border-r border-border">
          {line.oldNumber || ''}
        </span>
        <span className="w-10 px-2 text-right">
          {line.newNumber || ''}
        </span>
      </div>
      
      {/* Add comment button */}
      {onAddComment && lineNumber && (
        <button
          onClick={() => onAddComment(filePath, lineNumber)}
          className="w-6 flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      
      {/* Change indicator */}
      <div className="w-6 flex-shrink-0 flex items-center justify-center">
        {line.type === 'add' && <span className="text-green-500">+</span>}
        {line.type === 'delete' && <span className="text-red-500">-</span>}
      </div>
      
      {/* Content */}
      <pre className="flex-1 px-2 overflow-x-auto whitespace-pre">
        {line.content || ' '}
      </pre>
    </div>
  );
}

function FileDiffView({
  taskId,
  filePath,
  onAddComment,
}: {
  taskId: string;
  filePath: string;
  onAddComment?: (filePath: string, lineNumber: number) => void;
}) {
  const { data: diff, isLoading, error } = useFileDiff(taskId, filePath);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading diff...
      </div>
    );
  }

  if (error || !diff) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <AlertCircle className="h-5 w-5 mr-2" />
        {(error as Error)?.message || 'Failed to load diff'}
      </div>
    );
  }

  if (diff.hunks.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No changes in this file
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden bg-card">
      {/* File header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
        <div className="flex items-center gap-2">
          {statusIcons[diff.status]}
          <span className="font-mono text-sm">{diff.path}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-green-500">+{diff.additions}</span>
          <span className="text-red-500">-{diff.deletions}</span>
        </div>
      </div>
      
      {/* Hunks */}
      <div className="overflow-x-auto">
        {diff.hunks.map((hunk, idx) => (
          <DiffHunkView
            key={idx}
            hunk={hunk}
            filePath={filePath}
            onAddComment={onAddComment}
          />
        ))}
      </div>
    </div>
  );
}

export function DiffViewer({ task, onAddComment }: DiffViewerProps) {
  const hasWorktree = !!task.git?.worktreePath;
  const { data: summary, isLoading, error } = useDiffSummary(task.id, hasWorktree);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  if (!hasWorktree) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <AlertCircle className="h-5 w-5 mr-2" />
        No worktree active
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading changes...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <AlertCircle className="h-5 w-5 mr-2" />
        {(error as Error)?.message || 'Failed to load changes'}
      </div>
    );
  }

  if (!summary || summary.files.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[500px]">
      {/* File tree */}
      <div className="w-64 flex-shrink-0 border rounded-md overflow-hidden bg-card">
        <div className="px-3 py-2 border-b bg-muted/50">
          <div className="text-sm font-medium">
            Changed Files ({summary.totalFiles})
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="text-green-500">+{summary.totalAdditions}</span>
            {' / '}
            <span className="text-red-500">-{summary.totalDeletions}</span>
          </div>
        </div>
        <div className="p-2 overflow-y-auto h-[calc(100%-60px)]">
          <FileTree
            files={summary.files}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          <FileDiffView
            taskId={task.id}
            filePath={selectedFile}
            onAddComment={onAddComment}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground border rounded-md">
            <ChevronRight className="h-5 w-5 mr-2" />
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}
