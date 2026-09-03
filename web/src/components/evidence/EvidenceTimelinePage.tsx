import { EvidenceTimelinePanel } from './EvidenceTimelinePanel';
import { PrimaryPageShell } from '@/components/layout/PrimaryPageShell';

interface EvidenceTimelinePageProps {
  onBack: () => void;
  onTaskClick?: (taskId: string) => void;
}

export function EvidenceTimelinePage({ onBack, onTaskClick }: EvidenceTimelinePageProps) {
  return (
    <PrimaryPageShell
      title="Evidence Timeline"
      subtitle="Chronological task, telemetry, status, artifact, and work-product evidence."
      onBack={onBack}
      width="wide"
    >
      <EvidenceTimelinePanel
        showScopeFilters
        initialFrom={toLocalDateTimeInput(hoursAgo(168))}
        initialTo={toLocalDateTimeInput(new Date())}
        onTaskClick={onTaskClick}
      />
    </PrimaryPageShell>
  );
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

function toLocalDateTimeInput(date: Date): string {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}
