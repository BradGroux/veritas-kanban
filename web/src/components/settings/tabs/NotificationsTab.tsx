import {
  Badge,
  Code,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { SettingRow, ToggleRow, SectionHeader, SaveIndicator } from '../shared';
import { api, type OutboundDeliveryAttempt, type OutboundEndpointRecord } from '@/lib/api';

type CommunicationState = 'ok' | 'warn' | 'off' | 'unknown';

const STATE_COLORS: Record<CommunicationState, string> = {
  ok: 'green',
  warn: 'yellow',
  off: 'gray',
  unknown: 'blue',
};

function redactDestination(value?: string): string {
  if (!value?.trim()) return 'not configured';
  try {
    const parsed = new URL(value);
    const hasSensitiveParts = parsed.pathname !== '/' || parsed.search || parsed.hash;
    return hasSensitiveParts ? `${parsed.origin}/[redacted]` : parsed.origin;
  } catch {
    return '[redacted destination]';
  }
}

function formatDelivery(delivery?: OutboundDeliveryAttempt): string {
  if (!delivery) return 'not recorded';
  const status = delivery.responseStatus
    ? `${delivery.status} ${delivery.responseStatus}`
    : delivery.status;
  return `${status} at ${new Date(delivery.completedAt).toLocaleString()}`;
}

function notificationDestination(settings: { channel?: string; webhookUrl?: string }): string {
  const channel = settings.channel?.trim();
  const webhookUrl = settings.webhookUrl?.trim();
  if (channel && webhookUrl) return `Teams channel + webhook: ${redactDestination(webhookUrl)}`;
  if (channel) return 'Teams channel configured';
  if (webhookUrl) return `Webhook: ${redactDestination(webhookUrl)}`;

  return 'not configured';
}

function findDelivery(deliveries: OutboundDeliveryAttempt[], endpointId: string) {
  return deliveries.find((delivery) => delivery.endpointId === endpointId);
}

function findEndpoint(endpoints: OutboundEndpointRecord[], endpointId: string) {
  return endpoints.find((endpoint) => endpoint.id === endpointId);
}

function healthState(enabled: boolean, configured: boolean): CommunicationState {
  if (!enabled) return 'off';
  return configured ? 'ok' : 'warn';
}

function HealthCard({
  title,
  state,
  label,
  detail,
}: {
  title: string;
  state: CommunicationState;
  label: string;
  detail: string;
}) {
  return (
    <Paper withBorder radius="md" p="sm">
      <Group justify="space-between" gap="sm">
        <Text size="sm" fw={600}>
          {title}
        </Text>
        <Badge color={STATE_COLORS[state]} variant="light" tt="none">
          {label}
        </Badge>
      </Group>
      <Text size="xs" c="dimmed" mt={4}>
        {detail}
      </Text>
    </Paper>
  );
}

function endpointLabel(endpoint?: OutboundEndpointRecord): string {
  if (!endpoint) return 'endpoint pending';
  if (!endpoint.validation.valid) return `blocked: ${endpoint.validation.reason ?? 'invalid URL'}`;
  return endpoint.enabled ? 'endpoint enabled' : 'endpoint disabled';
}

export function NotificationsTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();
  const { data: outboundEndpoints = [] } = useQuery({
    queryKey: ['integrations', 'outbound', 'endpoints'],
    queryFn: api.integrations.outboundEndpoints,
    staleTime: 30_000,
    retry: false,
  });
  const { data: outboundDeliveries = [] } = useQuery({
    queryKey: ['integrations', 'outbound', 'deliveries', 25],
    queryFn: () => api.integrations.outboundDeliveries(25),
    staleTime: 30_000,
    retry: false,
  });

  const updateNotifications = (key: string, value: any) => {
    debouncedUpdate({ notifications: { [key]: value } });
  };

  const updateSquadWebhook = (key: string, value: any) => {
    debouncedUpdate({ squadWebhook: { [key]: value } });
  };

  const resetNotifications = () => {
    debouncedUpdate({
      notifications: DEFAULT_FEATURE_SETTINGS.notifications,
      squadWebhook: DEFAULT_FEATURE_SETTINGS.squadWebhook,
    });
  };

  const webhookMode = settings.squadWebhook?.mode ?? DEFAULT_FEATURE_SETTINGS.squadWebhook.mode;
  const notificationsEnabled =
    settings.notifications?.enabled ?? DEFAULT_FEATURE_SETTINGS.notifications.enabled;
  const notificationDestinationConfigured = Boolean(
    settings.notifications?.channel?.trim() || settings.notifications?.webhookUrl?.trim()
  );
  const failureWebhookConfigured = Boolean(settings.notifications?.webhookUrl?.trim());
  const failureAlertsEnabled =
    notificationsEnabled &&
    (settings.notifications?.onAgentFailure ??
      DEFAULT_FEATURE_SETTINGS.notifications.onAgentFailure);
  const squadWebhookEnabled =
    settings.squadWebhook?.enabled ?? DEFAULT_FEATURE_SETTINGS.squadWebhook.enabled;
  const squadDestination =
    webhookMode === 'openclaw'
      ? settings.squadWebhook?.openclawGatewayUrl
      : settings.squadWebhook?.url;
  const squadDestinationConfigured = Boolean(squadDestination?.trim());
  const squadEndpointId = webhookMode === 'openclaw' ? 'squad.openclawWake' : 'squad.webhook';
  const squadEndpoint = findEndpoint(outboundEndpoints, squadEndpointId);
  const squadDelivery = findDelivery(outboundDeliveries, squadEndpointId);
  const notificationEndpoint = findEndpoint(outboundEndpoints, 'notifications.failureAlert');
  const failureDelivery = findDelivery(outboundDeliveries, 'notifications.failureAlert');

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <SectionHeader title="Communication Health" />
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          <HealthCard
            title="Local Squad Chat"
            state="ok"
            label="Working"
            detail="Local messages save to the coordination log. External wake or reply behavior requires a configured consumer."
          />
          <HealthCard
            title="Squad Chat Webhook"
            state={healthState(squadWebhookEnabled, squadDestinationConfigured)}
            label={
              !squadWebhookEnabled
                ? 'Disabled'
                : squadDestinationConfigured
                  ? 'Configured'
                  : 'Missing destination'
            }
            detail={`${endpointLabel(squadEndpoint)}. Destination: ${redactDestination(squadDestination)}. HTTP accepted: ${formatDelivery(squadDelivery)}. Visually verified: not recorded in VK.`}
          />
          <HealthCard
            title="Broad Notifications"
            state={healthState(notificationsEnabled, notificationDestinationConfigured)}
            label={
              !notificationsEnabled
                ? 'Disabled'
                : notificationDestinationConfigured
                  ? 'Configured'
                  : 'Missing destination'
            }
            detail={`Destination: ${notificationDestination(settings.notifications ?? {})}. Last test result: not recorded in VK.`}
          />
          <HealthCard
            title="Failure Alerts"
            state={healthState(failureAlertsEnabled, failureWebhookConfigured)}
            label={
              !failureAlertsEnabled
                ? 'Disabled'
                : failureWebhookConfigured
                  ? 'Webhook configured'
                  : 'Stored only'
            }
            detail={`Immediate webhook: ${redactDestination(settings.notifications?.webhookUrl)}. ${endpointLabel(notificationEndpoint)}. HTTP accepted: ${formatDelivery(failureDelivery)}. Visually verified: not recorded in VK.`}
          />
          <HealthCard
            title="Inbound Wake / Replies"
            state={
              webhookMode === 'openclaw' && squadWebhookEnabled && squadDestinationConfigured
                ? 'ok'
                : 'off'
            }
            label={
              webhookMode === 'openclaw' && squadWebhookEnabled && squadDestinationConfigured
                ? 'OpenClaw configured'
                : 'Not configured'
            }
            detail="Generic webhooks are outbound only. OpenClaw Direct can wake a gateway; replies still require the external orchestrator."
          />
          <Paper withBorder radius="md" p="sm">
            <Stack gap={4}>
              <Group justify="space-between" gap="sm">
                <Text size="sm" fw={600}>
                  Payload & Signing
                </Text>
                <Badge color="blue" variant="light" tt="none">
                  Redacted
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Generic webhooks send <Code>event</Code>, <Code>message.id</Code>,{' '}
                <Code>message.agent</Code>, <Code>message.message</Code>,{' '}
                <Code>message.timestamp</Code>, and <Code>isHuman</Code>. HMAC signatures use{' '}
                <Code>X-VK-Signature</Code> when a secret is set. OpenClaw Direct posts a wake
                payload to <Code>/tools/invoke</Code> with bearer auth. Secrets and bearer tokens
                are not shown after save.
              </Text>
            </Stack>
          </Paper>
        </SimpleGrid>
      </div>

      <div className="border-t my-6" />

      <div className="flex items-center justify-between">
        <SectionHeader title="Notifications" onReset={resetNotifications} />
        <SaveIndicator isPending={isPending} />
      </div>
      <div className="divide-y">
        <ToggleRow
          label="Enable Notifications"
          description="Master toggle for all notification sends"
          checked={
            settings.notifications?.enabled ?? DEFAULT_FEATURE_SETTINGS.notifications.enabled
          }
          onCheckedChange={(v) => updateNotifications('enabled', v)}
        />
        {(settings.notifications?.enabled ?? DEFAULT_FEATURE_SETTINGS.notifications.enabled) && (
          <>
            <ToggleRow
              label="Task Complete"
              description="Notify when a task moves to Done"
              checked={
                settings.notifications?.onTaskComplete ??
                DEFAULT_FEATURE_SETTINGS.notifications.onTaskComplete
              }
              onCheckedChange={(v) => updateNotifications('onTaskComplete', v)}
            />
            <ToggleRow
              label="Agent Failure"
              description="Notify when an agent run fails"
              checked={
                settings.notifications?.onAgentFailure ??
                DEFAULT_FEATURE_SETTINGS.notifications.onAgentFailure
              }
              onCheckedChange={(v) => updateNotifications('onAgentFailure', v)}
            />
            <ToggleRow
              label="Blocked"
              description="Notify when a task is blocked"
              checked={
                settings.notifications?.onReviewNeeded ??
                DEFAULT_FEATURE_SETTINGS.notifications.onReviewNeeded
              }
              onCheckedChange={(v) => updateNotifications('onReviewNeeded', v)}
            />
            <SettingRow label="Channel" description="Teams channel ID for notifications">
              <TextInput
                value={
                  settings.notifications?.channel ?? DEFAULT_FEATURE_SETTINGS.notifications.channel
                }
                onChange={(e) => updateNotifications('channel', e.target.value)}
                placeholder="19:abc...@thread.tacv2"
                aria-label="Channel"
                size="xs"
                w={192}
              />
            </SettingRow>
            <SettingRow
              label="Failure Webhook URL"
              description="Optional Teams or generic webhook for immediate failure alert delivery"
            >
              <TextInput
                value={settings.notifications?.webhookUrl ?? ''}
                onChange={(e) => updateNotifications('webhookUrl', e.target.value || undefined)}
                placeholder="https://example.com/webhook"
                aria-label="Failure Webhook URL"
                size="xs"
                w={384}
                type="url"
              />
            </SettingRow>
          </>
        )}
      </div>

      <div className="border-t my-6" />

      <div className="space-y-4">
        <SectionHeader title="Squad Chat Webhook" />
        <p className="text-sm text-muted-foreground -mt-2">
          Fire HTTP webhooks or OpenClaw wake calls when squad messages are posted
        </p>
        <div className="divide-y">
          <ToggleRow
            label="Enable Webhook"
            description="Fire webhooks for squad chat messages"
            checked={
              settings.squadWebhook?.enabled ?? DEFAULT_FEATURE_SETTINGS.squadWebhook.enabled
            }
            onCheckedChange={(v) => updateSquadWebhook('enabled', v)}
          />
          {(settings.squadWebhook?.enabled ?? DEFAULT_FEATURE_SETTINGS.squadWebhook.enabled) && (
            <>
              <SettingRow label="Mode" description="Choose webhook destination type">
                <Select
                  value={webhookMode}
                  onChange={(value) => value && updateSquadWebhook('mode', value)}
                  data={[
                    { value: 'webhook', label: 'Generic Webhook' },
                    { value: 'openclaw', label: 'OpenClaw Direct' },
                  ]}
                  aria-label="Mode"
                  placeholder="Select mode"
                  allowDeselect={false}
                  size="xs"
                  w={192}
                />
              </SettingRow>

              {webhookMode === 'webhook' && (
                <>
                  <SettingRow
                    label="Webhook URL"
                    description="Where to POST squad message notifications"
                  >
                    <TextInput
                      value={settings.squadWebhook?.url ?? ''}
                      onChange={(e) => updateSquadWebhook('url', e.target.value)}
                      placeholder="https://example.com/webhook"
                      aria-label="Webhook URL"
                      size="xs"
                      w={384}
                      type="url"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Secret (Optional)"
                    description="HMAC signing secret for webhook verification (min 16 chars)"
                  >
                    <TextInput
                      value={settings.squadWebhook?.secret ?? ''}
                      onChange={(e) => updateSquadWebhook('secret', e.target.value || undefined)}
                      placeholder="your-secret-key"
                      aria-label="Secret (Optional)"
                      size="xs"
                      w={256}
                      type="password"
                    />
                  </SettingRow>
                </>
              )}

              {webhookMode === 'openclaw' && (
                <>
                  <SettingRow
                    label="Gateway URL"
                    description="OpenClaw gateway endpoint (e.g., http://127.0.0.1:18789)"
                  >
                    <TextInput
                      value={settings.squadWebhook?.openclawGatewayUrl ?? ''}
                      onChange={(e) => updateSquadWebhook('openclawGatewayUrl', e.target.value)}
                      placeholder="http://127.0.0.1:18789"
                      aria-label="Gateway URL"
                      size="xs"
                      w={384}
                      type="url"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Gateway Token"
                    description="OpenClaw gateway authorization token"
                  >
                    <TextInput
                      value={settings.squadWebhook?.openclawGatewayToken ?? ''}
                      onChange={(e) => updateSquadWebhook('openclawGatewayToken', e.target.value)}
                      placeholder="your-gateway-token"
                      aria-label="Gateway Token"
                      size="xs"
                      w={384}
                      type="password"
                    />
                  </SettingRow>
                </>
              )}

              <ToggleRow
                label="Notify on Human Messages"
                description="Fire webhook when a human posts in squad chat"
                checked={
                  settings.squadWebhook?.notifyOnHuman ??
                  DEFAULT_FEATURE_SETTINGS.squadWebhook.notifyOnHuman
                }
                onCheckedChange={(v) => updateSquadWebhook('notifyOnHuman', v)}
              />
              <ToggleRow
                label="Notify on Agent Messages"
                description="Fire webhook when an agent posts in squad chat"
                checked={
                  settings.squadWebhook?.notifyOnAgent ??
                  DEFAULT_FEATURE_SETTINGS.squadWebhook.notifyOnAgent
                }
                onCheckedChange={(v) => updateSquadWebhook('notifyOnAgent', v)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
