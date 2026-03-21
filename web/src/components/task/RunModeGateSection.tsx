/**
 * RunModeGateSection — v1
 *
 * Displays and manages:
 * - Run mode (strategy / eng-review / paranoid-review / qa)
 * - QA gate state (required + passed/not passed)
 *
 * Kept intentionally simple: no workflow engine, just a couple of selects
 * and a toggle button that PATCHes the task.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CheckCircle2, XCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { API_BASE } from '@/lib/config';
import { useToast } from '@/hooks/useToast';
import type { Task, RunMode, QaGateState } from '@veritas-kanban/shared';

interface RunModeGateSectionProps {
  task: Task;
  onUpdate: <K extends keyof Task>(field: K, value: Task[K]) => void;
  readOnly?: boolean;
}

const RUN_MODE_LABELS: Record<RunMode, string> = {
  strategy: '📋 Strategy',
  'eng-review': '🔧 Eng Review',
  'paranoid-review': '🔍 Paranoid Review',
  qa: '✅ QA',
};

const RUN_MODE_DESCRIPTIONS: Record<RunMode, string> = {
  strategy: 'High-level strategic review required before completion',
  'eng-review': 'Engineering review (PR / code quality) required',
  'paranoid-review': 'Extra-thorough review — security-sensitive or critical infra',
  qa: 'QA pass required before marking done',
};

export function RunModeGateSection({ task, onUpdate, readOnly = false }: RunModeGateSectionProps) {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const runMode = task.runMode ?? null;
  const qaGate = task.qaGate ?? null;

  const handleRunModeChange = async (value: string) => {
    const newMode = value === 'none' ? null : (value as RunMode);
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runMode: newMode }),
      });
      if (!res.ok) throw new Error(await res.text());
      onUpdate('runMode', newMode ?? undefined);
      toast({ title: newMode ? `Run mode set: ${RUN_MODE_LABELS[newMode]}` : 'Run mode cleared' });
    } catch (err) {
      toast({
        title: '❌ Failed to update run mode',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQaRequiredToggle = async (checked: boolean) => {
    const newGate: QaGateState = {
      required: checked,
      passed: checked ? (qaGate?.passed ?? false) : false,
      passedAt: checked ? qaGate?.passedAt : undefined,
      passedBy: checked ? qaGate?.passedBy : undefined,
    };
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qaGate: newGate }),
      });
      if (!res.ok) throw new Error(await res.text());
      onUpdate('qaGate', newGate);
      toast({ title: checked ? 'QA gate enabled' : 'QA gate disabled' });
    } catch (err) {
      toast({
        title: '❌ Failed to update QA gate',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleQaPassToggle = async () => {
    if (!qaGate?.required) return;
    const nowPassed = !qaGate.passed;
    const newGate: QaGateState = {
      required: true,
      passed: nowPassed,
      passedAt: nowPassed ? new Date().toISOString() : undefined,
      passedBy: nowPassed ? 'human' : undefined,
    };
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qaGate: newGate }),
      });
      if (!res.ok) throw new Error(await res.text());
      onUpdate('qaGate', newGate);
      toast({ title: nowPassed ? '✅ QA passed' : 'QA pass revoked' });
    } catch (err) {
      toast({
        title: '❌ Failed to update QA gate',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Run Mode */}
      <div className="space-y-2">
        <Label className="text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-3.5 w-3.5" />
          Run Mode
        </Label>
        {readOnly ? (
          <div>
            {runMode ? (
              <Badge variant="outline" className="text-xs">
                {RUN_MODE_LABELS[runMode]}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            )}
          </div>
        ) : (
          <Select value={runMode ?? 'none'} onValueChange={handleRunModeChange} disabled={isSaving}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select run mode…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                <span className="text-muted-foreground">None</span>
              </SelectItem>
              {(Object.keys(RUN_MODE_LABELS) as RunMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  <span className="font-medium">{RUN_MODE_LABELS[mode]}</span>
                  <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">
                    — {RUN_MODE_DESCRIPTIONS[mode]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {runMode && (
          <p className="text-xs text-muted-foreground">{RUN_MODE_DESCRIPTIONS[runMode]}</p>
        )}
      </div>

      {/* QA Gate */}
      <div className="space-y-2">
        <Label className="text-muted-foreground">QA Gate</Label>

        {readOnly ? (
          <div className="flex items-center gap-2">
            {qaGate?.required ? (
              qaGate.passed ? (
                <Badge className="bg-green-100 text-green-800 border-green-300 text-xs flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  QA Passed
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-xs flex items-center gap-1">
                  <XCircle className="h-3 w-3" />
                  QA Required — Not Passed
                </Badge>
              )
            ) : (
              <span className="text-xs text-muted-foreground">No QA gate</span>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Required toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm">Require QA before done</span>
              <Switch
                checked={qaGate?.required ?? false}
                onCheckedChange={handleQaRequiredToggle}
                disabled={isSaving}
              />
            </div>

            {/* Pass/fail button — only visible when required */}
            {qaGate?.required && (
              <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
                {qaGate.passed ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-green-700">QA Passed</p>
                      {qaGate.passedAt && (
                        <p className="text-xs text-muted-foreground">
                          {new Date(qaGate.passedAt).toLocaleString()}
                          {qaGate.passedBy ? ` · ${qaGate.passedBy}` : ''}
                        </p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleQaPassToggle}
                      disabled={isSaving}
                      className="text-xs h-7"
                    >
                      {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Revoke'}
                    </Button>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive">QA Not Passed</p>
                      <p className="text-xs text-muted-foreground">
                        Task cannot be moved to Done until QA is approved
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={handleQaPassToggle}
                      disabled={isSaving}
                      className="text-xs h-7 bg-green-600 hover:bg-green-700"
                    >
                      {isSaving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Pass QA
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
