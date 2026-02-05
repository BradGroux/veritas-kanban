import { useState, useRef } from 'react';
import { API_BASE } from '../../lib/config';
import {
  Paperclip,
  Upload,
  Trash2,
  Download,
  File,
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useUploadAttachment, useDeleteAttachment } from '@/hooks/useAttachments';
import { cn } from '@/lib/utils';
import type { Task, Attachment } from '@veritas-kanban/shared';

interface AttachmentsSectionProps {
  task: Task;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string): React.ReactNode {
  if (mimeType.startsWith('image/')) {
    return <FileImage className="h-4 w-4" />;
  }
  if (mimeType.includes('pdf')) {
    return <FileText className="h-4 w-4" />;
  }
  if (mimeType.includes('word') || mimeType.includes('document')) {
    return <FileText className="h-4 w-4" />;
  }
  if (mimeType.includes('sheet') || mimeType.includes('excel')) {
    return <FileSpreadsheet className="h-4 w-4" />;
  }
  if (mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('yaml')) {
    return <FileCode className="h-4 w-4" />;
  }
  return <File className="h-4 w-4" />;
}

function AttachmentItem({ taskId, attachment }: { taskId: string; attachment: Attachment }) {
  const [expanded, setExpanded] = useState(false);
  const [extractedText, setExtractedText] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const deleteAttachment = useDeleteAttachment();

  const isImage = attachment.mimeType.startsWith('image/');
  const isDocument = !isImage;

  const handleDelete = async () => {
    if (confirm(`Delete attachment "${attachment.originalName}"?`)) {
      await deleteAttachment.mutateAsync({ taskId, attachmentId: attachment.id });
    }
  };

  const handleToggleExpand = async () => {
    if (!expanded && extractedText === null && isDocument) {
      setLoadingText(true);
      try {
        const response = await fetch(
          `${API_BASE}/tasks/${taskId}/attachments/${attachment.id}/text`
        );
        const data = await response.json();
        setExtractedText(data.text || '(No text extracted)');
      } catch (error) {
        console.error('[Attachments] Failed to load extracted text:', error);
        setExtractedText('(Failed to load text)');
      } finally {
        setLoadingText(false);
      }
    }
    setExpanded(!expanded);
  };

  const downloadUrl = `${API_BASE}/tasks/${taskId}/attachments/${attachment.id}/download`;

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="text-muted-foreground mt-0.5">{getFileIcon(attachment.mimeType)}</div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{attachment.originalName}</div>
          <div className="text-xs text-muted-foreground">
            {formatFileSize(attachment.size)} • {new Date(attachment.uploaded).toLocaleDateString()}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isDocument && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleToggleExpand}
              disabled={loadingText}
              className="h-7 w-7 p-0"
              aria-label={expanded ? 'Collapse text preview' : 'Expand text preview'}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            asChild
            className="h-7 w-7 p-0"
            aria-label="Download attachment"
          >
            <a href={downloadUrl} download={attachment.originalName}>
              <Download className="h-3 w-3" />
            </a>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDelete}
            disabled={deleteAttachment.isPending}
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            aria-label="Delete attachment"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Image thumbnail */}
      {isImage && (
        <div className="mt-2">
          <img
            src={downloadUrl}
            alt={attachment.originalName}
            className="max-w-full h-auto rounded border"
            style={{ maxHeight: '300px' }}
          />
        </div>
      )}

      {/* Expanded text preview */}
      {expanded && isDocument && (
        <div className="mt-2 p-2 bg-muted/30 rounded text-xs font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
          {loadingText ? 'Loading...' : extractedText}
        </div>
      )}
    </div>
  );
}

export function AttachmentsSection({ task }: AttachmentsSectionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAttachment = useUploadAttachment();

  const attachments = task.attachments || [];
  const showWarning = attachments.length >= 2;

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    await uploadAttachment.mutateAsync({ taskId: task.id, formData });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <Label className="text-muted-foreground">Attachments</Label>
        {attachments.length > 0 && (
          <span className="text-xs text-muted-foreground">({attachments.length})</span>
        )}
      </div>

      {/* Token cost warning */}
      {showWarning && (
        <div className="flex items-start gap-3 p-3 rounded-md border border-amber-500 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-amber-900 dark:text-amber-200">
            ⚠️ Each attachment adds to agent token costs. Only include files essential for task
            context.
          </p>
        </div>
      )}

      {/* Upload zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging && 'border-primary bg-primary/5',
          !isDragging && 'border-muted-foreground/25 hover:border-muted-foreground/50',
          uploadAttachment.isPending && 'opacity-50 pointer-events-none'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
        <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-1">
          {uploadAttachment.isPending ? 'Uploading...' : 'Drop files here or click to browse'}
        </p>
        <p className="text-xs text-muted-foreground">Max 10MB per file, 20 files total</p>
      </div>

      {/* Attachments list */}
      {attachments.length === 0 ? (
        <div className="text-sm text-muted-foreground italic py-4 text-center border rounded-md">
          No attachments yet
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((attachment) => (
            <AttachmentItem key={attachment.id} taskId={task.id} attachment={attachment} />
          ))}
        </div>
      )}
    </div>
  );
}
