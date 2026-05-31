import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './test-utils';
import { IdentityProvider } from '@/hooks/useIdentity';
import { MultiUserTab } from '@/components/settings/tabs/MultiUserTab';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

const ownerProfile = {
  user: {
    id: 'local-user',
    displayName: 'Local User',
    email: 'local@example.com',
    handle: null,
    authSubject: null,
    avatarUrl: null,
    disabledAt: null,
    lastSeenAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  workspaces: [
    {
      workspace: {
        id: 'local',
        slug: 'local',
        name: 'Local Workspace',
        description: 'Default workspace',
        mode: 'local',
        createdBy: 'local-user',
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      membership: {
        workspaceId: 'local',
        userId: 'local-user',
        role: 'owner',
        status: 'active',
        invitedBy: null,
        joinedAt: '2026-01-01T00:00:00.000Z',
        disabledAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ],
};

const authContext = {
  role: 'admin',
  keyName: 'session',
  isLocalhost: true,
  userId: 'local-user',
  workspaceId: 'local',
  actorType: 'user',
  authMethod: 'session',
  tokenName: undefined,
  permissions: ['*'],
};

function renderMultiUserTab() {
  return renderWithProviders(
    <IdentityProvider>
      <MultiUserTab />
    </IdentityProvider>
  );
}

describe('MultiUserTab', () => {
  afterEach(() => {
    window.localStorage?.clear?.();
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders workspace members, invitations, and current API context for owners', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/context')) return jsonResponse(authContext);
        if (url.endsWith('/api/identity/profile')) return jsonResponse(ownerProfile);
        if (url.endsWith('/api/identity/workspaces/local/members')) {
          return jsonResponse([
            {
              ...ownerProfile.workspaces[0].membership,
              user: ownerProfile.user,
            },
          ]);
        }
        if (url.endsWith('/api/identity/workspaces/local/invitations')) {
          return jsonResponse([
            {
              id: 'inv_expired',
              workspaceId: 'local',
              email: 'expired@example.com',
              role: 'reviewer',
              tokenHash: 'hash',
              invitedBy: 'local-user',
              createdAt: '2026-01-01T00:00:00.000Z',
              expiresAt: '2026-01-02T00:00:00.000Z',
              acceptedBy: null,
              acceptedAt: null,
              revokedAt: null,
            },
          ]);
        }
        if (url.endsWith('/api/identity/workspaces/local/api-tokens')) {
          return jsonResponse([
            {
              id: 'token_cli',
              workspaceId: 'local',
              name: 'CLI worker',
              tokenPrefix: 'vk_pat_abcd1234',
              scopes: ['workspace:read', 'task:read'],
              createdBy: 'local-user',
              createdAt: '2026-01-01T00:00:00.000Z',
              expiresAt: null,
              revokedAt: null,
              revokedBy: null,
              lastUsedAt: null,
              lastUsedIp: null,
            },
          ]);
        }
        return jsonResponse({ error: `Unexpected ${url}` }, 404);
      })
    );

    renderMultiUserTab();

    expect(await screen.findByText('Local Workspace')).toBeDefined();
    expect(await screen.findByText('Local User')).toBeDefined();
    expect(await screen.findByText('expired@example.com')).toBeDefined();
    expect(await screen.findByText('CLI worker')).toBeDefined();
    expect(screen.getByText('Expired')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getAllByText('session').length).toBeGreaterThan(0);
  });

  it('shows invite permission state for read-only workspace members', async () => {
    const readOnlyProfile = {
      ...ownerProfile,
      workspaces: [
        {
          ...ownerProfile.workspaces[0],
          membership: {
            ...ownerProfile.workspaces[0].membership,
            role: 'read-only',
          },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/context')) {
          return jsonResponse({
            ...authContext,
            role: 'read-only',
            permissions: ['workspace:read', 'task:read', 'settings:read'],
          });
        }
        if (url.endsWith('/api/identity/profile')) return jsonResponse(readOnlyProfile);
        if (url.endsWith('/api/identity/workspaces/local/members')) {
          return jsonResponse([
            {
              ...readOnlyProfile.workspaces[0].membership,
              user: readOnlyProfile.user,
            },
          ]);
        }
        return jsonResponse([]);
      })
    );

    renderMultiUserTab();

    await waitFor(() => {
      expect(screen.getByText('Read-only')).toBeDefined();
      expect(
        screen.getByText('Owner or admin permission is required to view and send invitations.')
      ).toBeDefined();
    });
  });
});
