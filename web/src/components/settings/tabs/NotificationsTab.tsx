import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

  const webhookMode = settings.squadWebhook.mode || 'webhook';

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
          checked={settings.notifications.enabled}
          onCheckedChange={(v) => updateNotifications('enabled', v)}
        />
        {settings.notifications.enabled && (
          <>
            <ToggleRow
              label="Task Complete"
              description="Notify when a task moves to Done"
              checked={settings.notifications.onTaskComplete}
              onCheckedChange={(v) => updateNotifications('onTaskComplete', v)}
            />
            <ToggleRow
              label="Agent Failure"
              description="Notify when an agent run fails"
              checked={settings.notifications.onAgentFailure}
              onCheckedChange={(v) => updateNotifications('onAgentFailure', v)}
            />
            <ToggleRow
              label="Blocked"
              description="Notify when a task is blocked"
              checked={settings.notifications.onReviewNeeded}
              onCheckedChange={(v) => updateNotifications('onReviewNeeded', v)}
            />
            <SettingRow label="Channel" description="Teams channel ID for notifications">
              <Input
                value={settings.notifications.channel}
                onChange={(e) => updateNotifications('channel', e.target.value)}
                placeholder="19:abc...@thread.tacv2"
                className="w-48 h-8 text-xs"
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
            checked={settings.squadWebhook.enabled}
            onCheckedChange={(v) => updateSquadWebhook('enabled', v)}
          />
          {settings.squadWebhook.enabled && (
            <>
              <SettingRow label="Mode" description="Choose webhook destination type">
                <Select value={webhookMode} onValueChange={(v) => updateSquadWebhook('mode', v)}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="webhook">Generic Webhook</SelectItem>
                    <SelectItem value="openclaw">OpenClaw Direct</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              {webhookMode === 'webhook' && (
                <>
                  <SettingRow
                    label="Webhook URL"
                    description="Where to POST squad message notifications"
                  >
                    <Input
                      value={settings.squadWebhook.url || ''}
                      onChange={(e) => updateSquadWebhook('url', e.target.value)}
                      placeholder="https://example.com/webhook"
                      className="w-96 h-8 text-xs"
                      type="url"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Secret (Optional)"
                    description="HMAC signing secret for webhook verification (min 16 chars)"
                  >
                    <Input
                      value={settings.squadWebhook.secret || ''}
                      onChange={(e) => updateSquadWebhook('secret', e.target.value || undefined)}
                      placeholder="your-secret-key"
                      className="w-64 h-8 text-xs"
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
                    <Input
                      value={settings.squadWebhook.openclawGatewayUrl || ''}
                      onChange={(e) => updateSquadWebhook('openclawGatewayUrl', e.target.value)}
                      placeholder="http://127.0.0.1:18789"
                      className="w-96 h-8 text-xs"
                      type="url"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Gateway Token"
                    description="OpenClaw gateway authorization token"
                  >
                    <Input
                      value={settings.squadWebhook.openclawGatewayToken || ''}
                      onChange={(e) => updateSquadWebhook('openclawGatewayToken', e.target.value)}
                      placeholder="your-gateway-token"
                      className="w-96 h-8 text-xs"
                      type="password"
                    />
                  </SettingRow>
                </>
              )}

              <ToggleRow
                label="Notify on Human Messages"
                description="Fire webhook when a human posts in squad chat"
                checked={settings.squadWebhook.notifyOnHuman}
                onCheckedChange={(v) => updateSquadWebhook('notifyOnHuman', v)}
              />
              <ToggleRow
                label="Notify on Agent Messages"
                description="Fire webhook when an agent posts in squad chat"
                checked={settings.squadWebhook.notifyOnAgent}
                onCheckedChange={(v) => updateSquadWebhook('notifyOnAgent', v)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
