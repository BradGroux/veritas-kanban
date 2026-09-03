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
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  ThemeIcon,
} from '@mantine/core';
import { useUploadAttachment, useDeleteAttachment } from '@/hooks/useAttachments';
import { api } from '@/lib/api';
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteAttachment = useDeleteAttachment();

  const isImage = attachment.mimeType.startsWith('image/');
  const isDocument = !isImage;

  const handleDelete = async () => {
    await deleteAttachment.mutateAsync({ taskId, attachmentId: attachment.id });
    setDeleteDialogOpen(false);
  };

  const handleToggleExpand = async () => {
    if (!expanded && extractedText === null && isDocument) {
      setLoadingText(true);
      try {
        const data = await api.attachments.getText(taskId, attachment.id);
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
    <>
      <Paper className="space-y-2 p-3" radius="md" withBorder>
        <Group align="flex-start" gap="xs" wrap="nowrap">
          <Box className="mt-0.5 text-muted-foreground">{getFileIcon(attachment.mimeType)}</Box>
          <Box className="min-w-0 flex-1">
            <Text size="sm" fw={500} className="truncate">
              {attachment.originalName}
            </Text>
            <Text size="xs" c="dimmed">
              {formatFileSize(attachment.size)} •{' '}
              {new Date(attachment.uploaded).toLocaleDateString()}
            </Text>
          </Box>
          <Group gap={4}>
            {isDocument && (
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                onClick={() => {
                  void handleToggleExpand();
                }}
                disabled={loadingText}
                aria-label={expanded ? 'Collapse text preview' : 'Expand text preview'}
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </ActionIcon>
            )}
            <ActionIcon
              size="sm"
              variant="subtle"
              color="gray"
              component="a"
              href={downloadUrl}
              download={attachment.originalName}
              aria-label="Download attachment"
            >
              <Download className="h-3 w-3" />
            </ActionIcon>
            <ActionIcon
              size="sm"
              variant="subtle"
              color="red"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={deleteAttachment.isPending}
              aria-label="Delete attachment"
            >
              <Trash2 className="h-3 w-3" />
            </ActionIcon>
          </Group>
        </Group>

        {/* Image thumbnail */}
        {isImage && (
          <Box className="mt-2">
            <img
              src={downloadUrl}
              alt={attachment.originalName}
              className="max-w-full h-auto rounded border"
              style={{ maxHeight: '300px' }}
            />
          </Box>
        )}

        {/* Expanded text preview */}
        {expanded && isDocument && (
          <Paper
            className="mt-2 max-h-[300px] overflow-y-auto whitespace-pre-wrap bg-muted/30 p-2 text-xs"
            ff="monospace"
            radius="sm"
          >
            {loadingText ? 'Loading...' : extractedText}
          </Paper>
        )}
      </Paper>
      <Modal
        opened={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete attachment?"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            This will permanently delete "{attachment.originalName}". This action cannot be undone.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
              onClick={() => {
                void handleDelete();
              }}
              loading={deleteAttachment.isPending}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
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
    <Stack gap="md">
      <Group gap="xs">
        <Paperclip className="h-4 w-4 text-muted-foreground" />
        <Text size="sm" c="dimmed" fw={500}>
          Attachments
        </Text>
        {attachments.length > 0 && (
          <Text size="xs" c="dimmed">
            ({attachments.length})
          </Text>
        )}
      </Group>

      {/* Token cost warning */}
      {showWarning && (
        <Alert color="yellow" variant="light" icon={<AlertTriangle className="h-4 w-4" />}>
          Each attachment adds to agent token costs. Only include files essential for task context.
        </Alert>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />

      {/* Upload zone */}
      <Paper
        role="button"
        tabIndex={0}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          'cursor-pointer rounded-lg border-2 border-dashed transition-colors',
          attachments.length === 0 ? 'p-4' : 'p-8 text-center',
          isDragging && 'border-primary bg-primary/5',
          !isDragging && 'border-muted-foreground/25 hover:border-muted-foreground/50',
          uploadAttachment.isPending && 'pointer-events-none opacity-50'
        )}
        radius="lg"
        aria-label="Upload attachments"
      >
        {attachments.length === 0 ? (
          <Group gap="sm" wrap="nowrap">
            <ThemeIcon variant="light" color="gray" size="md" className="flex-shrink-0">
              <Upload className="h-4 w-4" />
            </ThemeIcon>
            <div className="min-w-0">
              <Text size="sm" fw={500}>
                {uploadAttachment.isPending ? 'Uploading...' : 'Add supporting files'}
              </Text>
              <Text size="xs" c="dimmed">
                Drop files here or browse. Max 10MB per file.
              </Text>
            </div>
          </Group>
        ) : (
          <>
            <ThemeIcon variant="transparent" color="gray" size="xl" className="mx-auto mb-2">
              <Upload className="h-8 w-8 text-muted-foreground" />
            </ThemeIcon>
            <Text size="sm" c="dimmed" className="mb-1">
              {uploadAttachment.isPending ? 'Uploading...' : 'Drop files here or click to browse'}
            </Text>
            <Text size="xs" c="dimmed">
              Max 10MB per file, 20 files total
            </Text>
          </>
        )}
      </Paper>

      {/* Attachments list */}
      {attachments.length > 0 && (
        <Stack gap="xs">
          {attachments.map((attachment) => (
            <AttachmentItem key={attachment.id} taskId={task.id} attachment={attachment} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
