import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  WorkspaceCapabilityFormat,
  WorkspaceCapabilityManifest,
  WorkspaceDelegatedWorkIntakeInput,
} from '@veritas-kanban/shared';

const DISCOVERY_KEY = ['workspace-capabilities', 'discover'] as const;
const DELEGATIONS_KEY = ['workspace-capabilities', 'delegations'] as const;

export function useWorkspaceCapabilityDiscovery() {
  return useQuery({
    queryKey: DISCOVERY_KEY,
    queryFn: api.workspaceCapabilities.discover,
  });
}

export function useWorkspaceDelegations() {
  return useQuery({
    queryKey: DELEGATIONS_KEY,
    queryFn: api.workspaceCapabilities.listDelegations,
  });
}

export function useRegisterTrustedWorkspaceCapability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      manifest?: unknown;
      content?: string;
      format?: WorkspaceCapabilityFormat;
      source?: string;
    }) => api.workspaceCapabilities.registerTrusted(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISCOVERY_KEY });
    },
  });
}

export function useSaveWorkspaceCapabilityManifest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (manifest: WorkspaceCapabilityManifest) =>
      api.workspaceCapabilities.saveManifest(manifest),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISCOVERY_KEY });
    },
  });
}

export function useWorkspaceDelegatedIntake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceDelegatedWorkIntakeInput) =>
      api.workspaceCapabilities.intake(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DELEGATIONS_KEY });
    },
  });
}
