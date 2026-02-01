import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  useIntegrationProviders,
  useIntegrations,
  useConnectIntegration,
  useDisconnectIntegration,
  useSyncIntegration,
} from '@/hooks/useIntegrations';
import { Loader2, Plug, Unplug, RefreshCw, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProviderInfo, IntegrationConfig } from '@/lib/api/integrations';

function ProviderCard({
  provider,
  config,
}: {
  provider: ProviderInfo;
  config?: IntegrationConfig;
}) {
  const [showConnect, setShowConnect] = useState(false);
  const [code, setCode] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [projectId, setProjectId] = useState('');

  const connectMutation = useConnectIntegration();
  const disconnectMutation = useDisconnectIntegration();
  const syncMutation = useSyncIntegration();

  const isConnected = config?.status === 'connected';
  const isLoading =
    connectMutation.isPending || disconnectMutation.isPending || syncMutation.isPending;

  const handleConnect = () => {
    connectMutation.mutate(
      {
        providerId: provider.id,
        params: {
          code,
          clientId,
          clientSecret,
          ...(projectId ? { projectId } : {}),
        },
      },
      {
        onSuccess: () => {
          setShowConnect(false);
          setCode('');
          setClientId('');
          setClientSecret('');
        },
      }
    );
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold',
              isConnected ? 'bg-green-500/20 text-green-500' : 'bg-muted text-muted-foreground'
            )}
          >
            {provider.name[0]}
          </div>
          <div>
            <div className="font-medium text-sm">{provider.name}</div>
            <div className="text-xs text-muted-foreground">{provider.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncMutation.mutate(provider.id)}
                disabled={isLoading}
              >
                {syncMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                <span className="ml-1.5">Sync</span>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={isLoading}>
                    <Unplug className="h-3 w-3" />
                    <span className="ml-1.5">Disconnect</span>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disconnect {provider.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the connection and delete stored credentials. You can
                      reconnect later.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => disconnectMutation.mutate(provider.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Disconnect
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          {!isConnected && !showConnect && (
            <Button variant="outline" size="sm" onClick={() => setShowConnect(true)}>
              <Plug className="h-3 w-3" />
              <span className="ml-1.5">Connect</span>
            </Button>
          )}
        </div>
      </div>

      {/* Connection status */}
      {isConnected && config && (
        <div className="text-xs text-muted-foreground space-y-0.5">
          <div>
            Connected{' '}
            {config.connectedAt ? `since ${new Date(config.connectedAt).toLocaleDateString()}` : ''}
          </div>
          {config.lastSyncAt && (
            <div>Last synced: {new Date(config.lastSyncAt).toLocaleString()}</div>
          )}
        </div>
      )}

      {/* Sync result */}
      {syncMutation.isSuccess && (
        <div className="text-xs text-green-500">
          Synced: {syncMutation.data.pulled} tasks pulled
          {syncMutation.data.errors.length > 0 && (
            <span className="text-red-400"> ({syncMutation.data.errors.length} errors)</span>
          )}
        </div>
      )}

      {/* Connect form */}
      {showConnect && (
        <div className="space-y-3 pt-2 border-t">
          {provider.authType === 'oauth2' && provider.oauthUrl && (
            <div className="text-xs text-muted-foreground">
              <a
                href={provider.oauthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-400 hover:underline"
              >
                Get OAuth code from {provider.name} <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
          <div className="grid gap-2">
            <div>
              <Label htmlFor={`${provider.id}-client-id`} className="text-xs">
                Client ID
              </Label>
              <Input
                id={`${provider.id}-client-id`}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="OAuth Client ID"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor={`${provider.id}-client-secret`} className="text-xs">
                Client Secret
              </Label>
              <Input
                id={`${provider.id}-client-secret`}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="OAuth Client Secret"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor={`${provider.id}-code`} className="text-xs">
                Authorization Code
              </Label>
              <Input
                id={`${provider.id}-code`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste OAuth code here"
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label htmlFor={`${provider.id}-project`} className="text-xs">
                Project ID (optional)
              </Label>
              <Input
                id={`${provider.id}-project`}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="Todoist project ID"
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!code || !clientId || !clientSecret || isLoading}
            >
              {connectMutation.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
              Connect
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowConnect(false)}>
              Cancel
            </Button>
          </div>
          {connectMutation.isError && (
            <div className="text-xs text-red-400">
              {connectMutation.error instanceof Error
                ? connectMutation.error.message
                : 'Connection failed'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function IntegrationsTab() {
  const { data: providers, isLoading: providersLoading } = useIntegrationProviders();
  const { data: integrations, isLoading: integrationsLoading } = useIntegrations();

  const isLoading = providersLoading || integrationsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Integrations</h3>
        <p className="text-xs text-muted-foreground">
          Connect external services to sync tasks bidirectionally.
        </p>
      </div>
      <div className="space-y-3">
        {providers?.map((provider) => {
          const config = integrations?.find((i) => i.providerId === provider.id);
          return <ProviderCard key={provider.id} provider={provider} config={config} />;
        })}
        {(!providers || providers.length === 0) && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No integration providers available.
          </div>
        )}
      </div>
    </div>
  );
}
