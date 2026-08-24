import { useEffect, useState } from 'react';
import { Button, Group, Loader, Modal, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { Download } from 'lucide-react';
import { API_BASE, apiResponse } from '@/lib/api/helpers';

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

  useEffect(() => {
    if (!open) return;

    setFormat('csv');
    setScope(initialTaskId ? 'task' : initialProject ? 'project' : 'full');
    setTaskId(initialTaskId || '');
    setProject(initialProject || '');
    setFromDate('');
    setToDate('');
  }, [open, initialTaskId, initialProject]);

  const handleExport = async () => {
    setIsExporting(true);

    try {
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
        const toDateTime = new Date(toDate);
        toDateTime.setHours(23, 59, 59, 999);
        params.set('to', toDateTime.toISOString());
      }

      const response = await apiResponse(`${API_BASE}/telemetry/export?${params}`);

      const disposition = response.headers.get('Content-Disposition');
      let filename = `telemetry-export.${format}`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) {
          filename = match[1];
        }
      }

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
    } finally {
      setIsExporting(false);
    }
  };

  const handleClose = () => onOpenChange(false);

  return (
    <Modal
      opened={open}
      onClose={handleClose}
      size="md"
      centered
      title={
        <Group gap="sm">
          <Download className="h-5 w-5" />
          <Title order={2} className="text-lg">
            Export Metrics
          </Title>
        </Group>
      }
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Export telemetry data as CSV or JSON for reporting and analysis.
        </Text>

        <Select
          label="Format"
          value={format}
          onChange={(value) => setFormat((value ?? 'csv') as ExportFormat)}
          data={[
            { value: 'csv', label: 'CSV (Spreadsheets)' },
            { value: 'json', label: 'JSON (Programmatic)' },
          ]}
        />

        <Select
          label="Scope"
          value={scope}
          onChange={(value) => setScope((value ?? 'full') as ExportScope)}
          data={[
            { value: 'full', label: 'All Data' },
            { value: 'project', label: 'By Project' },
            { value: 'task', label: 'By Task' },
          ]}
        />

        {scope === 'project' &&
          (projects.length > 0 ? (
            <Select
              label="Project"
              value={project}
              onChange={(value) => setProject(value ?? '')}
              placeholder="Select project..."
              data={projects.map((p) => ({ value: p.id, label: p.label }))}
            />
          ) : (
            <TextInput
              label="Project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="Project name"
            />
          ))}

        {scope === 'task' && (
          <TextInput
            label="Task ID"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            placeholder="task_..."
          />
        )}

        <TextInput
          label="From"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />

        <TextInput
          label="To"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
        />

        <Group justify="flex-end" mt="sm">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={
              isExporting || (scope === 'task' && !taskId) || (scope === 'project' && !project)
            }
            leftSection={isExporting ? <Loader size={14} /> : <Download className="h-4 w-4" />}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
