/**
 * DelegationTab — Approval Delegation (Vacation Mode) Settings
 */

import { useState } from 'react';
import { API_BASE } from '@/lib/config';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Select, Switch } from '@mantine/core';
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
      const res = await fetch(`${API_BASE}/delegation`);
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
      const res = await fetch(`${API_BASE}/delegation`, {
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
      const res = await fetch(`${API_BASE}/delegation`, { method: 'DELETE' });
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
            <Badge variant="light" color="blue" size="sm">
              Active
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">🤖 Delegate Agent:</span>
              <Badge variant="light" color="gray" size="sm">
                {delegation.delegateAgent}
              </Badge>
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
              mt="sm"
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
            <Select
              id="delegate-agent"
              label="Delegate Agent"
              value={delegateAgent}
              onChange={(value) => value && setDelegateAgent(value)}
              data={[
                { value: 'veritas', label: 'VERITAS' },
                { value: 'claude-code', label: 'Claude Code' },
                { value: 'amp', label: 'Amp' },
              ]}
              description="This agent will be able to approve tasks on your behalf"
              allowDeselect={false}
            />
          </div>

          <div className="space-y-2">
            <Select
              id="duration"
              label="Duration"
              value={durationHours.toString()}
              onChange={(value) => value && setDurationHours(parseInt(value, 10))}
              data={[
                { value: '1', label: '1 hour' },
                { value: '4', label: '4 hours' },
                { value: '8', label: '8 hours (work day)' },
                { value: '12', label: '12 hours' },
                { value: '24', label: '24 hours (1 day)' },
                { value: '48', label: '48 hours (2 days)' },
                { value: '72', label: '72 hours (3 days)' },
                { value: '168', label: '1 week' },
              ]}
              allowDeselect={false}
            />
          </div>

          <div className="space-y-2">
            <Select
              id="scope"
              label="Scope"
              value={scopeType}
              onChange={(value) => value && setScopeType(value as 'all' | 'project' | 'priority')}
              data={[
                { value: 'all', label: 'All tasks' },
                { value: 'project', label: 'Specific projects' },
                { value: 'priority', label: 'Specific priorities' },
              ]}
              description="Which tasks can the delegate approve?"
              allowDeselect={false}
            />
          </div>

          <div className="space-y-2">
            <Switch
              id="exclude-critical"
              label="Exclude critical priority tasks"
              checked={excludeCritical}
              onChange={(event) => setExcludeCritical(event.currentTarget.checked)}
              description="Critical tasks will still require manual approval"
            />
          </div>

          <Button
            onClick={handleEnableDelegation}
            disabled={setDelegationMutation.isPending || (isActive && !hasExpired)}
            fullWidth
            leftSection={
              isActive && !hasExpired ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Plane className="h-4 w-4" />
              )
            }
          >
            {isActive && !hasExpired ? 'Delegation Active' : 'Enable Delegation'}
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
