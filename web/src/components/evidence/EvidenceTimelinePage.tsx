import { Button, Group, Text } from '@mantine/core';
import { ArrowLeft, History } from 'lucide-react';
import { EvidenceTimelinePanel } from './EvidenceTimelinePanel';

interface EvidenceTimelinePageProps {
  onBack: () => void;
  onTaskClick?: (taskId: string) => void;
}

export function EvidenceTimelinePage({ onBack, onTaskClick }: EvidenceTimelinePageProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Button variant="subtle" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Board
          </Button>
          <div className="min-w-0">
            <Group gap="xs" wrap="wrap">
              <h1 className="text-2xl font-bold">Evidence Timeline</h1>
              <History className="h-5 w-5 text-muted-foreground" />
            </Group>
            <Text size="sm" c="dimmed">
              Chronological task, telemetry, status, artifact, and work-product evidence.
            </Text>
          </div>
        </div>
      </div>

      <EvidenceTimelinePanel
        showScopeFilters
        initialFrom={toLocalDateTimeInput(hoursAgo(168))}
        initialTo={toLocalDateTimeInput(new Date())}
        onTaskClick={onTaskClick}
      />
    </div>
  );
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function toLocalDateTimeInput(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}
