import { useState } from 'react';
import { ArrowLeft, CheckCircle2, AlertTriangle, GitBranch, MinusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useDecision, useUpdateDecisionAssumption } from '@/hooks/useDecisions';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

interface DecisionDetailProps {
  decisionId: string;
  onBack: () => void;
}

const assumptionTone = {
  pending: 'bg-muted text-muted-foreground',
  validated: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  invalidated: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
} as const;

export function DecisionDetail({ decisionId, onBack }: DecisionDetailProps) {
  const { data, isLoading } = useDecision(decisionId);
  const updateAssumption = useUpdateDecisionAssumption();
  const { toast } = useToast();
  const [notes, setNotes] = useState<Record<number, string>>({});

  const handleAssumptionUpdate = async (index: number, status: 'validated' | 'invalidated') => {
    try {
      await updateAssumption.mutateAsync({
        id: decisionId,
        index,
        input: {
          status,
          note: notes[index]?.trim() || undefined,
        },
      });
      toast({
        title: 'Assumption updated',
        description: `Marked as ${status}.`,
      });
    } catch (error) {
      toast({
        title: 'Failed to update assumption',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Loading decision details...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        Decision not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Decisions
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{data.decision.agentId}</Badge>
          <Badge variant="outline">{data.decision.taskId}</Badge>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
        <section className="rounded-lg border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Decision Chain</h2>
          </div>
          <div className="space-y-3">
            {data.chain.map((item, index) => (
              <div key={item.id} className="relative pl-6">
                {index < data.chain.length - 1 && (
                  <span className="absolute left-[10px] top-6 h-[calc(100%-8px)] w-px bg-border" />
                )}
                <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <div
                  className={cn(
                    'rounded-md border p-3',
                    item.id === data.decision.id && 'border-primary bg-primary/5'
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.outputAction}</span>
                    {item.id === data.decision.id && <Badge>Selected</Badge>}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.inputContext}</p>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span>Confidence {item.confidenceLevel}%</span>
                    <span>Risk {item.riskScore}</span>
                    <span>{new Date(item.timestamp).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-semibold">Assumptions</h2>
          <div className="mt-4 space-y-4">
            {data.decision.assumptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assumptions recorded.</p>
            ) : (
              data.decision.assumptions.map((assumption, index) => (
                <div key={`${assumption.text}-${index}`} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm leading-6">{assumption.text}</p>
                    <Badge className={cn('shrink-0', assumptionTone[assumption.status])}>
                      {assumption.status}
                    </Badge>
                  </div>
                  {assumption.note && (
                    <p className="mt-2 text-xs text-muted-foreground">{assumption.note}</p>
                  )}
                  <Textarea
                    value={notes[index] ?? assumption.note ?? ''}
                    onChange={(event) =>
                      setNotes((current) => ({ ...current, [index]: event.target.value }))
                    }
                    placeholder="Validation note"
                    className="mt-3 min-h-20"
                  />
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAssumptionUpdate(index, 'validated')}
                      disabled={updateAssumption.isPending}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Validate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAssumptionUpdate(index, 'invalidated')}
                      disabled={updateAssumption.isPending}
                    >
                      <AlertTriangle className="mr-2 h-4 w-4" />
                      Invalidate
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-6 rounded-md border border-dashed p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MinusCircle className="h-4 w-4 text-muted-foreground" />
              Current Outcome
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{data.decision.outputAction}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
