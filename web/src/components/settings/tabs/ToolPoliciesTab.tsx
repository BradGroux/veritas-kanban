import { UiAction, UiPill, UiIconAction } from '@/components/ui/UiVocabulary';
import { SettingsNotice, SettingsGroup } from '@/components/settings/shared/SettingsLayout';
/**
 * Tool Policies Settings Tab
 * GitHub Issue: #110
 *
 * Manage role-based tool access policies for workflow agents.
 */

import { useState, useEffect, useCallback } from 'react';
import { Group, Modal, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { apiFetch } from '@/lib/api/helpers';
import { useToast } from '@/hooks/useToast';
import { Edit, Info, Plus, Trash2 } from 'lucide-react';
import { SettingsPage, SettingsSection } from '../shared';

interface ToolPolicy {
  role: string;
  allowed: string[];
  denied: string[];
  description: string;
}

const DEFAULT_ROLES = new Set(['planner', 'developer', 'reviewer', 'tester', 'deployer']);

export function ToolPoliciesTab() {
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const { toast } = useToast();

  // Form state
  const [formRole, setFormRole] = useState('');
  const [formAllowed, setFormAllowed] = useState('');
  const [formDenied, setFormDenied] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const fetchPolicies = useCallback(async () => {
    try {
      setLoading(true);
      const result = await apiFetch<ToolPolicy[]>('/api/tool-policies');
      setPolicies(result);
    } catch (error) {
      toast({
        title: 'Failed to load policies',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  const openEditDialog = (policy: ToolPolicy | null) => {
    if (policy) {
      setFormRole(policy.role);
      setFormAllowed(policy.allowed.join(', '));
      setFormDenied(policy.denied.join(', '));
      setFormDescription(policy.description);
      setIsNew(false);
    } else {
      setFormRole('');
      setFormAllowed('');
      setFormDenied('');
      setFormDescription('');
      setIsNew(true);
    }
    setEditDialogOpen(true);
  };

  const handleSavePolicy = async () => {
    const policy: ToolPolicy = {
      role: formRole.trim().toLowerCase(),
      allowed: formAllowed
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      denied: formDenied
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      description: formDescription.trim(),
    };

    try {
      const url = isNew ? '/api/tool-policies' : `/api/tool-policies/${policy.role}`;
      const method = isNew ? 'POST' : 'PUT';

      await apiFetch<ToolPolicy>(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });

      toast({
        title: isNew ? 'Policy created' : 'Policy updated',
        description: `Tool policy for role "${policy.role}" has been saved.`,
      });
      setEditDialogOpen(false);
      void fetchPolicies();
    } catch (error) {
      toast({
        title: 'Failed to save policy',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDeletePolicy = async (role: string) => {
    if (DEFAULT_ROLES.has(role)) {
      toast({
        title: 'Cannot delete default policy',
        description: 'Default policies can be edited but not deleted.',
        variant: 'destructive',
      });
      return;
    }

    if (!confirm(`Delete policy for role "${role}"?`)) {
      return;
    }

    try {
      await apiFetch<{ deleted: string }>(`/api/tool-policies/${role}`, {
        method: 'DELETE',
      });

      toast({
        title: 'Policy deleted',
        description: `Tool policy for role "${role}" has been deleted.`,
      });
      void fetchPolicies();
    } catch (error) {
      toast({
        title: 'Failed to delete policy',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading tool policies...</div>;
  }

  return (
    <SettingsPage
      title="Tool Policies"
      description="Define which tools each agent role can access when workflow steps run."
    >
      <SettingsSection
        title="Role Policies"
        description="Review default and custom role allowlists and denylists."
        tone="advanced"
        actions={
          <UiAction
            variant="primary"
            type="button"
            onClick={() => openEditDialog(null)}
            leftSection={<Plus className="h-4 w-4" />}
          >
            New Policy
          </UiAction>
        }
      >
        <SettingsNotice icon={<Info className="h-5 w-5" />}>
          <Text size="sm">
            <strong>Default roles:</strong> planner, developer, reviewer, tester, deployer.
            <br />
            Default policies can be edited but not deleted. Custom roles can be created for
            specialized workflows.
          </Text>
        </SettingsNotice>

        <div className="mt-4 space-y-3">
          {policies.length === 0 ? (
            <SettingsGroup className="text-center text-muted-foreground py-8">
              No policies defined
            </SettingsGroup>
          ) : (
            policies.map((policy) => (
              <SettingsGroup key={policy.role} className="hover:bg-muted/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{policy.role}</h4>
                      {DEFAULT_ROLES.has(policy.role) && <UiPill>default</UiPill>}
                    </div>

                    <p className="text-sm text-muted-foreground">{policy.description}</p>

                    <div className="flex flex-col gap-2 text-sm">
                      <div className="flex items-start gap-2">
                        <span className="font-medium text-muted-foreground min-w-[100px]">
                          Allowed:
                        </span>
                        {policy.allowed.length === 0 ? (
                          <span className="text-muted-foreground">none</span>
                        ) : policy.allowed.includes('*') ? (
                          <UiPill>all tools</UiPill>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {policy.allowed.slice(0, 5).map((tool) => (
                              <UiPill key={tool}>{tool}</UiPill>
                            ))}
                            {policy.allowed.length > 5 && (
                              <UiPill>+{policy.allowed.length - 5} more</UiPill>
                            )}
                          </div>
                        )}
                      </div>

                      {policy.denied.length > 0 && (
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-muted-foreground min-w-[100px]">
                            Denied:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {policy.denied.slice(0, 5).map((tool) => (
                              <UiPill kind="status" tone="error" key={tool}>
                                {tool}
                              </UiPill>
                            ))}
                            {policy.denied.length > 5 && (
                              <UiPill kind="status" tone="error">
                                +{policy.denied.length - 5} more
                              </UiPill>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <UiIconAction
                      variant="quiet"
                      type="button"
                      aria-label={`Edit ${policy.role}`}
                      onClick={() => openEditDialog(policy)}
                    >
                      <Edit className="h-4 w-4" />
                    </UiIconAction>
                    {!DEFAULT_ROLES.has(policy.role) && (
                      <UiIconAction
                        variant="destructive"
                        type="button"
                        aria-label={`Delete ${policy.role}`}
                        onClick={() => handleDeletePolicy(policy.role)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </UiIconAction>
                    )}
                  </div>
                </div>
              </SettingsGroup>
            ))
          )}
        </div>
      </SettingsSection>

      <Modal
        opened={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        title={isNew ? 'Create Tool Policy' : `Edit Policy: ${formRole}`}
        size="lg"
        radius="md"
        centered
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Define tool access restrictions for an agent role. Denied tools take precedence over
            allowed tools.
          </Text>

          <TextInput
            label="Role Name"
            description="Role name (lowercase, no spaces). Cannot be changed after creation."
            value={formRole}
            onChange={(e) => setFormRole(e.target.value)}
            placeholder="e.g., analyst, deployer, custom-role"
            disabled={!isNew}
            size="sm"
            radius="md"
          />

          <TextInput
            label="Allowed Tools"
            description="Comma-separated list of tool names. Use * to allow all tools."
            value={formAllowed}
            onChange={(e) => setFormAllowed(e.target.value)}
            placeholder="e.g., Read, web_search, browser or * for all"
            size="sm"
            radius="md"
          />

          <TextInput
            label="Denied Tools"
            description="Comma-separated list of tool names. Denied tools take precedence."
            value={formDenied}
            onChange={(e) => setFormDenied(e.target.value)}
            placeholder="e.g., Write, Edit, exec, message"
            size="sm"
            radius="md"
          />

          <Textarea
            label="Description"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            placeholder="Describe when to use this role and what it can do..."
            rows={3}
            size="sm"
            radius="md"
          />

          <Group justify="flex-end" gap="sm">
            <UiAction variant="secondary" type="button" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </UiAction>
            <UiAction variant="primary" type="button" onClick={handleSavePolicy}>
              {isNew ? 'Create' : 'Save Changes'}
            </UiAction>
          </Group>
        </Stack>
      </Modal>
    </SettingsPage>
  );
}
