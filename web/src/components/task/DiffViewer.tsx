import { useState } from 'react';
import { useDiffSummary, useFileDiff } from '@/hooks/useDiff';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  FileCode,
  FilePlus,
  FileMinus,
  FileEdit,
  ChevronRight,
  Loader2,
  AlertCircle,
  Plus,
  MessageSquare,
  X,
} from 'lucide-react';
import type { Task, ReviewComment } from '@veritas-kanban/shared';
import type { FileChange, DiffLine, DiffHunk } from '@/lib/api';
import { cn } from '@/lib/utils';
import { nanoid } from 'nanoid';

interface DiffViewerProps {
  task: Task;
  onAddComment: (comment: ReviewComment) => void;
  onRemoveComment: (commentId: string) => void;
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
  comments,
}: {
  files: FileChange[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  comments: ReviewComment[];
}) {
  const commentsByFile = comments.reduce((acc, c) => {
    acc[c.file] = (acc[c.file] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

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
            {commentsByFile[file.path] && (
              <span className="flex items-center gap-0.5 text-amber-500">
                <MessageSquare className="h-3 w-3" />
                {commentsByFile[file.path]}
              </span>
            )}
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

function CommentInput({
  onSubmit,
  onCancel,
}: {
  onSubmit: (content: string) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState('');

  const handleSubmit = () => {
    if (content.trim()) {
      onSubmit(content.trim());
      setContent('');
    }
  };

  return (
    <div className="p-2 bg-amber-500/10 border-l-2 border-amber-500 space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add review comment..."
        rows={2}
        className="text-xs"
        autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={!content.trim()}>
          Add Comment
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CommentDisplay({
  comment,
  onRemove,
}: {
  comment: ReviewComment;
  onRemove: () => void;
}) {
  return (
    <div className="p-2 bg-amber-500/10 border-l-2 border-amber-500 group">
      <div className="flex items-start justify-between">
        <p className="text-xs whitespace-pre-wrap">{comment.content}</p>
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">
        {new Date(comment.created).toLocaleString()}
      </p>
    </div>
  );
}

function DiffLineView({
  line,
  comments,
  addingCommentAtLine,
  onStartAddComment,
  onSubmitComment,
  onCancelComment,
  onRemoveComment,
}: {
  line: DiffLine;
  comments: ReviewComment[];
  addingCommentAtLine: number | null;
  onStartAddComment: (line: number) => void;
  onSubmitComment: (content: string) => void;
  onCancelComment: () => void;
  onRemoveComment: (commentId: string) => void;
}) {
  const lineNumber = line.newNumber || line.oldNumber;
  const lineComments = comments.filter(c => c.line === lineNumber);
  const isAddingHere = addingCommentAtLine === lineNumber;
  
  return (
    <>
      <div
        className={cn(
          'group flex hover:bg-muted/30',
          line.type === 'add' && 'bg-green-500/10',
          line.type === 'delete' && 'bg-red-500/10',
          lineComments.length > 0 && 'bg-amber-500/5'
        )}
      >
        {/* Line numbers */}
        <div className="flex-shrink-0 w-20 flex text-muted-foreground select-none border-r border-border">
          <span className="w-10 px-2 text-right border-r border-border text-[10px]">
            {line.oldNumber || ''}
          </span>
          <span className="w-10 px-2 text-right text-[10px]">
            {line.newNumber || ''}
          </span>
        </div>
        
        {/* Add comment button */}
        {lineNumber && (
          <button
            onClick={() => onStartAddComment(lineNumber)}
            className="w-6 flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-amber-500"
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
        <pre className="flex-1 px-2 overflow-x-auto whitespace-pre text-xs">
          {line.content || ' '}
        </pre>

        {/* Comment indicator */}
        {lineComments.length > 0 && (
          <div className="flex-shrink-0 px-2 flex items-center">
            <MessageSquare className="h-3 w-3 text-amber-500" />
          </div>
        )}
      </div>

      {/* Inline comments */}
      {lineComments.map(comment => (
        <CommentDisplay
          key={comment.id}
          comment={comment}
          onRemove={() => onRemoveComment(comment.id)}
        />
      ))}

      {/* Comment input */}
      {isAddingHere && (
        <CommentInput
          onSubmit={onSubmitComment}
          onCancel={onCancelComment}
        />
      )}
    </>
  );
}

function DiffHunkView({
  hunk,
  comments,
  addingCommentAtLine,
  onStartAddComment,
  onSubmitComment,
  onCancelComment,
  onRemoveComment,
}: {
  hunk: DiffHunk;
  comments: ReviewComment[];
  addingCommentAtLine: number | null;
  onStartAddComment: (line: number) => void;
  onSubmitComment: (content: string) => void;
  onCancelComment: () => void;
  onRemoveComment: (commentId: string) => void;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="bg-muted/50 px-4 py-1 text-xs text-muted-foreground font-mono">
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      
      <div className="font-mono text-xs">
        {hunk.lines.map((line, idx) => (
          <DiffLineView
            key={idx}
            line={line}
            comments={comments}
            addingCommentAtLine={addingCommentAtLine}
            onStartAddComment={onStartAddComment}
            onSubmitComment={onSubmitComment}
            onCancelComment={onCancelComment}
            onRemoveComment={onRemoveComment}
          />
        ))}
      </div>
    </div>
  );
}

function FileDiffView({
  taskId,
  filePath,
  comments,
  onAddComment,
  onRemoveComment,
}: {
  taskId: string;
  filePath: string;
  comments: ReviewComment[];
  onAddComment: (comment: ReviewComment) => void;
  onRemoveComment: (commentId: string) => void;
}) {
  const { data: diff, isLoading, error } = useFileDiff(taskId, filePath);
  const [addingCommentAtLine, setAddingCommentAtLine] = useState<number | null>(null);

  const fileComments = comments.filter(c => c.file === filePath);

  const handleSubmitComment = (content: string) => {
    if (addingCommentAtLine === null) return;
    
    const comment: ReviewComment = {
      id: `comment_${nanoid(8)}`,
      file: filePath,
      line: addingCommentAtLine,
      content,
      created: new Date().toISOString(),
    };
    
    onAddComment(comment);
    setAddingCommentAtLine(null);
  };

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
      <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
        <div className="flex items-center gap-2">
          {statusIcons[diff.status]}
          <span className="font-mono text-sm">{diff.path}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {fileComments.length > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <MessageSquare className="h-3 w-3" />
              {fileComments.length}
            </span>
          )}
          <span className="text-green-500">+{diff.additions}</span>
          <span className="text-red-500">-{diff.deletions}</span>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        {diff.hunks.map((hunk, idx) => (
          <DiffHunkView
            key={idx}
            hunk={hunk}
            comments={fileComments}
            addingCommentAtLine={addingCommentAtLine}
            onStartAddComment={setAddingCommentAtLine}
            onSubmitComment={handleSubmitComment}
            onCancelComment={() => setAddingCommentAtLine(null)}
            onRemoveComment={onRemoveComment}
          />
        ))}
      </div>
    </div>
  );
}

export function DiffViewer({ task, onAddComment, onRemoveComment }: DiffViewerProps) {
  const hasWorktree = !!task.git?.worktreePath;
  const { data: summary, isLoading, error } = useDiffSummary(task.id, hasWorktree);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const comments = task.reviewComments || [];

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
            {comments.length > 0 && (
              <>
                {' / '}
                <span className="text-amber-500">{comments.length} comments</span>
              </>
            )}
          </div>
        </div>
        <div className="p-2 overflow-y-auto h-[calc(100%-60px)]">
          <FileTree
            files={summary.files}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            comments={comments}
          />
        </div>
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-y-auto">
        {selectedFile ? (
          <FileDiffView
            taskId={task.id}
            filePath={selectedFile}
            comments={comments}
            onAddComment={onAddComment}
            onRemoveComment={onRemoveComment}
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
