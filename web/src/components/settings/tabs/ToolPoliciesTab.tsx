/**
 * Tool Policies Settings Tab
 * GitHub Issue: #110
 *
 * Manage role-based tool access policies for workflow agents.
 */

import { useState, useEffect } from 'react';
import { API_BASE } from '@/lib/config';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, Edit, Trash2, Shield, Info } from 'lucide-react';

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

  const fetchPolicies = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE}/tool-policies`);
      const result = await response.json();
      if (result.success) {
        setPolicies(result.data);
      } else {
        toast({
          title: 'Failed to load policies',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to load policies',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPolicies();
  }, []);

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

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: isNew ? 'Policy created' : 'Policy updated',
          description: `Tool policy for role "${policy.role}" has been saved.`,
        });
        setEditDialogOpen(false);
        fetchPolicies();
      } else {
        toast({
          title: 'Failed to save policy',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
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
      const response = await fetch(`${API_BASE}/tool-policies/${role}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Policy deleted',
          description: `Tool policy for role "${role}" has been deleted.`,
        });
        fetchPolicies();
      } else {
        toast({
          title: 'Failed to delete policy',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
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
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Tool Policies
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Define which tools each agent role can access. Tool policies are applied when workflow
          steps specify an agent role.
        </p>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex gap-2">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900 dark:text-blue-100">
            <strong>Default roles:</strong> planner, developer, reviewer, tester, deployer.
            <br />
            Default policies can be edited but not deleted. Custom roles can be created for
            specialized workflows.
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => openEditDialog(null)} size="sm">
          <Plus className="h-4 w-4 mr-2" />
          New Policy
        </Button>
      </div>

      <div className="space-y-3">
        {policies.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 border rounded-lg">
            No policies defined
          </div>
        ) : (
          policies.map((policy) => (
            <div
              key={policy.role}
              className="border rounded-lg p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{policy.role}</h4>
                    {DEFAULT_ROLES.has(policy.role) && (
                      <Badge variant="secondary" className="text-xs">
                        default
                      </Badge>
                    )}
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
                        <Badge variant="outline">all tools</Badge>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {policy.allowed.slice(0, 5).map((tool) => (
                            <Badge key={tool} variant="outline" className="text-xs">
                              {tool}
                            </Badge>
                          ))}
                          {policy.allowed.length > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{policy.allowed.length - 5} more
                            </Badge>
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
                            <Badge key={tool} variant="destructive" className="text-xs">
                              {tool}
                            </Badge>
                          ))}
                          {policy.denied.length > 5 && (
                            <Badge variant="destructive" className="text-xs">
                              +{policy.denied.length - 5} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(policy)}
                    className="h-8 w-8 p-0"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  {!DEFAULT_ROLES.has(policy.role) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeletePolicy(policy.role)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Create Tool Policy' : `Edit Policy: ${formRole}`}</DialogTitle>
            <DialogDescription>
              Define tool access restrictions for an agent role. Denied tools take precedence over
              allowed tools.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="role">Role Name</Label>
              <Input
                id="role"
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                placeholder="e.g., analyst, deployer, custom-role"
                disabled={!isNew}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Role name (lowercase, no spaces). Cannot be changed after creation.
              </p>
            </div>

            <div>
              <Label htmlFor="allowed">Allowed Tools</Label>
              <Input
                id="allowed"
                value={formAllowed}
                onChange={(e) => setFormAllowed(e.target.value)}
                placeholder="e.g., Read, web_search, browser or * for all"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Comma-separated list of tool names. Use * to allow all tools.
              </p>
            </div>

            <div>
              <Label htmlFor="denied">Denied Tools</Label>
              <Input
                id="denied"
                value={formDenied}
                onChange={(e) => setFormDenied(e.target.value)}
                placeholder="e.g., Write, Edit, exec, message"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Comma-separated list of tool names. Denied tools take precedence.
              </p>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Describe when to use this role and what it can do..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePolicy}>{isNew ? 'Create' : 'Save Changes'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
