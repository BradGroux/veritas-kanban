import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTaskWorkProducts, useWorkProductVersions } from '@/hooks/useWorkProducts';
import { toast } from '@/hooks/useToast';
import {
  AlertCircle,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  History,
  Pencil,
  Sparkles,
} from 'lucide-react';
import type {
  WorkProductKind,
  WorkProductPreview,
  WorkProductVersion,
} from '@veritas-kanban/shared';

interface WorkProductsSectionProps {
  taskId: string;
}

const KIND_LABELS: Record<WorkProductKind, string> = {
  checklist: 'Checklist',
  dashboard: 'Dashboard',
  markdown: 'Markdown',
  report: 'Report',
  summary: 'Summary',
  table: 'Table',
  text: 'Text',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function safeDownloadName(product: WorkProductPreview, extension: string): string {
  const slug = product.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${slug || product.id}-v${product.version}.${extension}`;
}

function versionLabel(version: WorkProductVersion): string {
  const changeType = version.changeType.charAt(0).toUpperCase() + version.changeType.slice(1);
  return `${changeType} v${version.version}`;
}

async function writeClipboardText(content: string): Promise<void> {
  const clipboard = window.navigator.clipboard;
  if (clipboard?.writeText) {
    await clipboard.writeText(content);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error('Clipboard is unavailable');
  }
}

export function WorkProductsSection({ taskId }: WorkProductsSectionProps) {
  const queryClient = useQueryClient();
  const { data: products = [], isLoading, error } = useTaskWorkProducts(taskId);
  const [historyProduct, setHistoryProduct] = useState<WorkProductPreview | null>(null);
  const [editProduct, setEditProduct] = useState<WorkProductPreview | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const { data: versions = [], isLoading: versionsLoading } = useWorkProductVersions(
    historyProduct?.id ?? null
  );
  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [products]
  );

  const copyRedacted = async (product: WorkProductPreview) => {
    try {
      const content = await api.workProducts.export(product.id, {
        format: 'markdown',
        redacted: true,
      });
      await writeClipboardText(content);
      toast({
        title: 'Work product copied',
        description: `${product.title} was copied with redaction enabled.`,
      });
    } catch (err) {
      toast({
        title: 'Copy failed',
        description: err instanceof Error ? err.message : 'Could not copy work product.',
        variant: 'destructive',
      });
    }
  };

  const openEditor = async (product: WorkProductPreview) => {
    setEditProduct(product);
    setEditTitle(product.title);
    setEditBody('');
    setEditLoading(true);
    try {
      const content = await api.workProducts.export(product.id, {
        format: 'markdown',
        redacted: true,
      });
      setEditBody(content);
    } catch (err) {
      toast({
        title: 'Edit load failed',
        description:
          err instanceof Error ? err.message : 'Could not load editable work product content.',
        variant: 'destructive',
      });
      setEditProduct(null);
    } finally {
      setEditLoading(false);
    }
  };

  const saveEdit = async () => {
    if (!editProduct) return;
    const title = editTitle.trim();
    const markdown = editBody.trimEnd();
    if (!title || !markdown) {
      toast({
        title: 'Edit not saved',
        description: 'Title and content are required.',
        variant: 'destructive',
      });
      return;
    }

    setEditSaving(true);
    try {
      await api.workProducts.update(editProduct.id, {
        title,
        render: {
          schemaVersion: 1,
          kind: 'markdown',
          markdown,
        },
        changeType: 'manual',
        changeSummary: 'Manual edit before handoff',
      });
      await queryClient.invalidateQueries({ queryKey: ['tasks', taskId, 'work-products'] });
      toast({
        title: 'Work product updated',
        description: `${title} was saved as a new version.`,
      });
      setEditProduct(null);
      setEditTitle('');
      setEditBody('');
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save work product edit.',
        variant: 'destructive',
      });
    } finally {
      setEditSaving(false);
    }
  };

  const exportRedacted = async (product: WorkProductPreview) => {
    try {
      const content = await api.workProducts.export(product.id, {
        format: 'markdown',
        redacted: true,
      });
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = safeDownloadName(product, 'md');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({
        title: 'Work product exported',
        description: `${product.title} was exported with redaction enabled.`,
      });
    } catch (err) {
      toast({
        title: 'Export failed',
        description: err instanceof Error ? err.message : 'Could not export work product.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Paper withBorder p="md" radius="md">
        <Group gap="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Loading work products...
          </Text>
        </Group>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert
        color="red"
        icon={<AlertCircle className="h-4 w-4" />}
        title="Work products failed to load"
      >
        {error instanceof Error ? error.message : 'Could not load task work products.'}
      </Alert>
    );
  }

  return (
    <>
      <Stack gap="md">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Group gap="xs">
              <ThemeIcon size="sm" radius="xl" variant="light">
                <Sparkles className="h-4 w-4" />
              </ThemeIcon>
              <Text fw={600}>Work Products</Text>
              <Badge variant="light" color="gray">
                {sortedProducts.length}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" mt={4}>
              Durable outputs linked to this task, with redacted copy/export defaults.
            </Text>
          </div>
        </Group>

        {sortedProducts.length === 0 ? (
          <Paper withBorder p="lg" radius="md" className="text-center">
            <ThemeIcon size="lg" radius="xl" variant="light" className="mx-auto">
              <FileText className="h-5 w-5" />
            </ThemeIcon>
            <Text fw={600} mt="sm">
              No work products yet
            </Text>
            <Text size="sm" c="dimmed" mt={4}>
              Generated reports, checklists, handoff notes, and evidence summaries will appear here.
            </Text>
          </Paper>
        ) : (
          <Stack gap="sm">
            {sortedProducts.map((product) => (
              <Paper key={product.id} withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
                    <div className="min-w-0">
                      <Group gap="xs" wrap="wrap">
                        <Text fw={600} className="break-words">
                          {product.title}
                        </Text>
                        <Badge variant="light">{KIND_LABELS[product.kind]}</Badge>
                        <Badge
                          variant="outline"
                          color={product.status === 'active' ? 'green' : 'gray'}
                        >
                          {product.status}
                        </Badge>
                        {product.redacted && (
                          <Badge variant="outline" color="yellow">
                            Redacted preview
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed" mt={4}>
                        Updated {formatDate(product.updatedAt)} | v{product.version}
                        {product.agent ? ` | ${product.agent}` : ''}
                        {product.model ? ` | ${product.model}` : ''}
                      </Text>
                    </div>
                    <Group gap={4} wrap="nowrap">
                      <Tooltip label="Copy redacted markdown">
                        <ActionIcon
                          aria-label={`Copy redacted ${product.title}`}
                          variant="subtle"
                          onClick={() => copyRedacted(product)}
                        >
                          <Clipboard className="h-4 w-4" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Edit redacted markdown">
                        <ActionIcon
                          aria-label={`Edit ${product.title}`}
                          variant="subtle"
                          onClick={() => openEditor(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Export redacted markdown">
                        <ActionIcon
                          aria-label={`Export redacted ${product.title}`}
                          variant="subtle"
                          onClick={() => exportRedacted(product)}
                        >
                          <Download className="h-4 w-4" />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Version history">
                        <ActionIcon
                          aria-label={`Open version history for ${product.title}`}
                          variant="subtle"
                          onClick={() => setHistoryProduct(product)}
                        >
                          <History className="h-4 w-4" />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>

                  <Text size="sm" c="dimmed" className="whitespace-pre-wrap">
                    {product.snippet || 'No preview text available.'}
                  </Text>

                  {(product.sourceRunId || (product.sourceLinks?.length ?? 0) > 0) && (
                    <Group gap="xs" wrap="wrap">
                      {product.sourceRunId && (
                        <Badge variant="light" color="blue">
                          Run {product.sourceRunId}
                        </Badge>
                      )}
                      {product.sourceLinks?.map((link) => (
                        <Button
                          key={`${product.id}:${link.href}:${link.label}`}
                          component="a"
                          href={link.href}
                          target={link.href.startsWith('http') ? '_blank' : undefined}
                          rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                          variant="subtle"
                          size="compact-xs"
                          rightSection={<ExternalLink className="h-3 w-3" />}
                        >
                          {link.label}
                        </Button>
                      ))}
                    </Group>
                  )}
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Stack>

      <Modal
        opened={Boolean(historyProduct)}
        onClose={() => setHistoryProduct(null)}
        title={historyProduct ? `Version history: ${historyProduct.title}` : 'Version history'}
        size="lg"
      >
        {versionsLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading version history...
            </Text>
          </Group>
        ) : versions.length === 0 ? (
          <Text size="sm" c="dimmed">
            No version history is available for this work product.
          </Text>
        ) : (
          <ScrollArea h={320}>
            <Table striped highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Version</Table.Th>
                  <Table.Th>Changed</Table.Th>
                  <Table.Th>Summary</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {versions.map((version) => (
                  <Table.Tr key={version.id}>
                    <Table.Td>
                      <Badge variant="light">{versionLabel(version)}</Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatDate(version.createdAt)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{version.changeSummary || version.title}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Modal>

      <Modal
        opened={Boolean(editProduct)}
        onClose={() => {
          if (!editSaving) setEditProduct(null);
        }}
        title={editProduct ? `Edit: ${editProduct.title}` : 'Edit work product'}
        size="xl"
      >
        {editLoading ? (
          <Group gap="sm">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              Loading editable content...
            </Text>
          </Group>
        ) : (
          <Stack gap="sm">
            <TextInput
              label="Title"
              value={editTitle}
              onChange={(event) => setEditTitle(event.currentTarget.value)}
              disabled={editSaving}
            />
            <Textarea
              label="Redacted markdown"
              minRows={14}
              value={editBody}
              onChange={(event) => setEditBody(event.currentTarget.value)}
              disabled={editSaving}
            />
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" onClick={() => setEditProduct(null)} disabled={editSaving}>
                Cancel
              </Button>
              <Button onClick={saveEdit} loading={editSaving}>
                Save Version
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </>
  );
}
