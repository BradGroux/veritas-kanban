import { Select, TextInput } from '@mantine/core';
import { useFeatureSettings, useDebouncedFeatureUpdate } from '@/hooks/useFeatureSettings';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';
import { SettingRow, ToggleRow, SectionHeader, SaveIndicator } from '../shared';

export function NotificationsTab() {
  const { settings } = useFeatureSettings();
  const { debouncedUpdate, isPending } = useDebouncedFeatureUpdate();

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

  return (
    <div className="space-y-4">
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
