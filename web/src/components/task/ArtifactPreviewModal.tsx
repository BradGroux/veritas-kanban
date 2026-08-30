import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, ZoomIn, ZoomOut } from 'lucide-react';
import type { WorkProductArtifactPreview } from '@veritas-kanban/shared';
import { workProductsApi } from '@/lib/api/work-products';
import { useView } from '@/contexts/ViewContext';
import { toast } from '@/hooks/useToast';
import { ArtifactSafeMarkdown } from './ArtifactSafeMarkdown';

interface ArtifactPreviewModalProps {
  opened: boolean;
  productId: string | null;
  version?: number;
  title?: string;
  onClose: () => void;
}

export function ArtifactPreviewModal({
  opened,
  productId,
  version,
  title,
  onClose,
}: ArtifactPreviewModalProps) {
  const { navigateToTask } = useView();
  const [zoom, setZoom] = useState(1);
  const query = useQuery({
    queryKey: ['work-products', 'artifact-preview', productId, version],
    queryFn: () => workProductsApi.previewArtifact(productId as string, version),
    enabled: opened && Boolean(productId),
    staleTime: 30_000,
  });
  const preview = query.data;

  const download = async () => {
    if (!productId || !preview?.actions.downloadAllowed || !preview.artifact) return;
    try {
      const blob = await workProductsApi.downloadArtifact(productId, preview.artifact.version);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = preview.artifact.safeName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: 'Download failed',
        description: error instanceof Error ? error.message : 'Artifact download failed.',
        variant: 'destructive',
      });
    }
  };

  const openCausalEvent = () => {
    if (!preview?.causalEvent) return;
    const event = preview.causalEvent;
    onClose();
    navigateToTask(event.taskId, {
      tab: 'timeline',
      timelineAttemptId: event.attemptId,
      timelineEventId: event.eventId,
    });
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title ? `Preview: ${title}` : 'Artifact preview'}
      size="xl"
      centered
      returnFocus
    >
      <Stack gap="md" aria-live="polite">
        {query.isLoading && (
          <Group gap="xs">
            <Loader size="sm" />
            <Text size="sm">Preparing bounded preview...</Text>
          </Group>
        )}
        {query.error && (
          <Alert color="red" title="Preview failed" icon={<AlertTriangle className="h-4 w-4" />}>
            {query.error instanceof Error ? query.error.message : 'Preview could not be loaded.'}
          </Alert>
        )}
        {preview && <PreviewBody preview={preview} zoom={zoom} />}
        {preview?.artifact && (
          <Stack gap={4}>
            <Group gap="xs" wrap="wrap">
              <Badge variant="light">v{preview.artifact.version}</Badge>
              <Badge variant="outline">{preview.artifact.mediaType}</Badge>
              <Badge variant="outline">{preview.redactionState ?? 'unknown'} redaction</Badge>
              <Badge variant="outline">run {preview.sourceRunId}</Badge>
            </Group>
            <Text size="xs" c="dimmed" className="break-all">
              SHA-256 {preview.artifact.sha256}
            </Text>
          </Stack>
        )}
        {preview?.truncation.truncated && (
          <Alert color="yellow" title="Preview truncated">
            {preview.truncation.reasons.join(' ') || 'Server preview limits were reached.'}
          </Alert>
        )}
        {preview && (
          <Group justify="space-between" wrap="wrap">
            <Group gap="xs">
              {(preview.renderer === 'image' || preview.renderer === 'pdf') && (
                <>
                  <Button
                    variant="default"
                    size="xs"
                    leftSection={<ZoomOut className="h-3 w-3" />}
                    onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                    aria-label="Zoom preview out"
                  >
                    Zoom out
                  </Button>
                  <Text size="xs" aria-label={`Preview zoom ${Math.round(zoom * 100)} percent`}>
                    {Math.round(zoom * 100)}%
                  </Text>
                  <Button
                    variant="default"
                    size="xs"
                    leftSection={<ZoomIn className="h-3 w-3" />}
                    onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
                    aria-label="Zoom preview in"
                  >
                    Zoom in
                  </Button>
                </>
              )}
            </Group>
            <Group gap="xs">
              {preview.causalEvent && (
                <Button
                  variant="subtle"
                  size="xs"
                  leftSection={<ExternalLink className="h-3 w-3" />}
                  onClick={openCausalEvent}
                >
                  Causal event
                </Button>
              )}
              <Button
                size="xs"
                leftSection={<Download className="h-3 w-3" />}
                disabled={!preview.actions.downloadAllowed}
                onClick={download}
              >
                Download
              </Button>
            </Group>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}

function PreviewBody({ preview, zoom }: { preview: WorkProductArtifactPreview; zoom: number }) {
  if (preview.status !== 'ready' || !preview.content) {
    return (
      <Alert
        color="yellow"
        title={statusLabel(preview.status)}
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        {preview.message}
      </Alert>
    );
  }
  if (preview.content.kind === 'text') {
    return (
      <ScrollArea.Autosize mah={520} type="auto">
        {preview.renderer === 'markdown' ? (
          <ArtifactSafeMarkdown content={preview.content.text} />
        ) : (
          <Code block className="whitespace-pre-wrap break-words text-sm">
            {preview.content.text}
          </Code>
        )}
      </ScrollArea.Autosize>
    );
  }
  if (preview.content.kind === 'image') {
    const content = preview.content;
    return (
      <ScrollArea h={520} type="auto">
        <img
          src={`data:${preview.artifact?.mediaType};base64,${content.base64}`}
          alt={preview.artifact?.safeName ?? 'Artifact image preview'}
          width={content.width}
          height={content.height}
          style={{ maxWidth: 'none', transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        />
      </ScrollArea>
    );
  }
  if (preview.content.kind === 'pdf') {
    return (
      <Paper withBorder p="xs" h={520} style={{ overflow: 'auto' }}>
        <iframe
          title={`${preview.artifact?.safeName ?? 'Artifact'} PDF preview`}
          src={`data:application/pdf;base64,${preview.content.base64}`}
          sandbox=""
          referrerPolicy="no-referrer"
          style={{
            border: 0,
            width: `${100 / zoom}%`,
            height: `${500 / zoom}px`,
            transform: `scale(${zoom})`,
            transformOrigin: 'top left',
          }}
        />
      </Paper>
    );
  }
  return (
    <Stack gap="md">
      {preview.content.sheets.map((sheet) => (
        <Stack key={sheet.name} gap="xs">
          <Group gap="xs">
            <Text fw={600} size="sm">
              {sheet.name}
            </Text>
            <Badge variant="outline">{sheet.totalRows} rows</Badge>
            <Badge variant="outline">{sheet.totalColumns} columns</Badge>
          </Group>
          <Table.ScrollContainer minWidth={500} maxHeight={420} type="native">
            <Table striped withTableBorder withColumnBorders stickyHeader>
              <Table.Tbody>
                {sheet.rows.map((row, rowIndex) => (
                  <Table.Tr key={`${sheet.name}:row:${rowIndex}`}>
                    {row.map((cell, columnIndex) => (
                      <Table.Td key={`${sheet.name}:${rowIndex}:${columnIndex}`}>
                        <Text size="xs" ff={cell.formula ? 'monospace' : undefined}>
                          {cell.text}
                        </Text>
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      ))}
    </Stack>
  );
}

function statusLabel(status: WorkProductArtifactPreview['status']): string {
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
