/**
 * DelegationTab — Approval Delegation (Vacation Mode) Settings
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/useToast';
import { Plane, ShieldCheck, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import type { DelegationSettings } from '@veritas-kanban/shared';

interface DelegationResponse {
  delegation: DelegationSettings | null;
}

function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setHours(result.getHours() + hours);
  return result;
}

export function DelegationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Local form state
  const [delegateAgent, setDelegateAgent] = useState('veritas');
  const [durationHours, setDurationHours] = useState(24);
  const [scopeType, setScopeType] = useState<'all' | 'project' | 'priority'>('all');
  const [excludeCritical, setExcludeCritical] = useState(true);

  // Fetch current delegation
  const { data, isLoading } = useQuery<DelegationResponse>({
    queryKey: ['delegation'],
    queryFn: async () => {
      const res = await fetch('/api/delegation');
      if (!res.ok) throw new Error('Failed to fetch delegation settings');
      return res.json();
    },
  });

  const delegation = data?.delegation;

  // Set delegation mutation
  const setDelegationMutation = useMutation({
    mutationFn: async (params: {
      delegateAgent: string;
      expires: string;
      scope: { type: 'all' | 'project' | 'priority' };
      excludePriorities?: string[];
      createdBy: string;
    }) => {
      const res = await fetch('/api/delegation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to set delegation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegation'] });
      toast({
        title: '✅ Delegation Enabled',
        description: `${delegateAgent} can now approve tasks`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: '❌ Failed to Enable Delegation',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Revoke delegation mutation
  const revokeDelegationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/delegation', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke delegation');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delegation'] });
      toast({
        title: '🔒 Delegation Revoked',
        description: 'Approval authority has been revoked',
      });
    },
    onError: (error: Error) => {
      toast({
        title: '❌ Failed to Revoke',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleEnableDelegation = () => {
    const expires = addHours(new Date(), durationHours).toISOString();
    const excludePriorities = excludeCritical ? ['critical'] : undefined;

    setDelegationMutation.mutate({
      delegateAgent,
      expires,
      scope: { type: scopeType },
      excludePriorities,
      createdBy: 'human', // Could be dynamic based on auth
    });
  };

  const handleRevokeDelegation = () => {
    revokeDelegationMutation.mutate();
  };

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading delegation settings...</div>;
  }

  const isActive = delegation?.enabled;
  const hasExpired = delegation && new Date(delegation.expires) < new Date();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium flex items-center gap-2">
          <Plane className="h-5 w-5 text-blue-500" />
          Approval Delegation (Vacation Mode)
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Temporarily delegate task approval authority to an agent while you're away
        </p>
      </div>

      {/* Active Delegation Banner */}
      {isActive && !hasExpired && delegation && (
        <div className="border-2 border-blue-500 bg-blue-50 dark:bg-blue-950 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="font-semibold text-base">Delegation Active</span>
            </div>
            <span className="px-2 py-1 text-xs rounded-full bg-blue-100 dark:bg-blue-900">
              Active
            </span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">🤖 Delegate Agent:</span>
              <span className="px-2 py-0.5 text-xs rounded bg-gray-200 dark:bg-gray-800">
                {delegation.delegateAgent}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>Expires: {formatDateTime(delegation.expires)}</span>
            </div>
            {delegation.excludePriorities && delegation.excludePriorities.length > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>Excludes: {delegation.excludePriorities.join(', ')} priority</span>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevokeDelegation}
              disabled={revokeDelegationMutation.isPending}
              className="mt-3"
            >
              Revoke Delegation
            </Button>
          </div>
        </div>
      )}

      {/* Expired Notice */}
      {delegation && hasExpired && (
        <div className="border-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-950 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="font-semibold text-base">Delegation Expired</span>
          </div>
          <p className="text-sm">The delegation expired on {formatDateTime(delegation.expires)}</p>
        </div>
      )}

      <hr className="border-t border-gray-200 dark:border-gray-700" />

      {/* Setup Form */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <div className="mb-3">
          <h4 className="font-semibold text-base">Set Up Delegation</h4>
          <p className="text-sm text-muted-foreground">
            Configure approval delegation for a specific time period
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delegate-agent">Delegate Agent</Label>
            <Select value={delegateAgent} onValueChange={setDelegateAgent}>
              <SelectTrigger id="delegate-agent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="veritas">VERITAS</SelectItem>
                <SelectItem value="claude-code">Claude Code</SelectItem>
                <SelectItem value="amp">Amp</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This agent will be able to approve tasks on your behalf
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="duration">Duration</Label>
            <Select
              value={durationHours.toString()}
              onValueChange={(v) => setDurationHours(parseInt(v, 10))}
            >
              <SelectTrigger id="duration">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 hour</SelectItem>
                <SelectItem value="4">4 hours</SelectItem>
                <SelectItem value="8">8 hours (work day)</SelectItem>
                <SelectItem value="12">12 hours</SelectItem>
                <SelectItem value="24">24 hours (1 day)</SelectItem>
                <SelectItem value="48">48 hours (2 days)</SelectItem>
                <SelectItem value="72">72 hours (3 days)</SelectItem>
                <SelectItem value="168">1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="scope">Scope</Label>
            <Select value={scopeType} onValueChange={(v: any) => setScopeType(v)}>
              <SelectTrigger id="scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tasks</SelectItem>
                <SelectItem value="project">Specific projects</SelectItem>
                <SelectItem value="priority">Specific priorities</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Which tasks can the delegate approve?</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Switch
                id="exclude-critical"
                checked={excludeCritical}
                onCheckedChange={setExcludeCritical}
              />
              <Label htmlFor="exclude-critical">Exclude critical priority tasks</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Critical tasks will still require manual approval
            </p>
          </div>

          <Button
            onClick={handleEnableDelegation}
            disabled={setDelegationMutation.isPending || (isActive && !hasExpired)}
            className="w-full"
          >
            {isActive && !hasExpired ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Delegation Active
              </>
            ) : (
              <>
                <Plane className="mr-2 h-4 w-4" />
                Enable Delegation
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Info Card */}
      <div className="border border-gray-200 dark:border-gray-800 rounded-lg p-4">
        <h4 className="font-semibold text-sm mb-2">How It Works</h4>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            • The delegated agent can mark tasks as "done" without human approval during the
            delegation period
          </p>
          <p>• All delegated approvals are logged for audit purposes</p>
          <p>• Delegation automatically expires after the configured duration</p>
          <p>• You can revoke delegation at any time</p>
        </div>
      </div>
    </div>
  );
}
