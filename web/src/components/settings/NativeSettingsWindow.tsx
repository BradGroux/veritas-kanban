import { useQueryClient } from '@tanstack/react-query';
import { getFeatureSettingsWrites } from '@/lib/feature-settings-writes';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { SettingsDialog } from './SettingsDialog';
import { useIdentity } from '@/hooks/useIdentity';
import { desktopSettingsBridge } from '@/lib/desktop-settings';

/** Same authenticated settings content, without a modal or board mounted underneath. */
export function NativeSettingsWindow() {
  const { hasPermission, isLoading, error, authContext } = useIdentity();
  const writer = getFeatureSettingsWrites(useQueryClient());
  const [target, setTarget] = useState<{ section?: string; control?: string }>({});
  const allowed =
    Boolean(authContext) &&
    !error &&
    (hasPermission('settings:read') || hasPermission('admin:manage'));
  useEffect(() => {
    if (isLoading) return;
    return desktopSettingsBridge()?.onMenuCommand?.(async (request) => {
      if (request.command === 'open-settings' && request.payload?.flushPending === true) {
        try {
          await writer.settle();
          return { accepted: true };
        } catch {
          return {
            accepted: false,
            message: 'Settings changes are not saved. Retry the save before quitting.',
          };
        }
      }
      if (!allowed)
        return {
          accepted: false,
          message: 'Settings read permission is required to open Settings.',
        };
      let section =
        typeof request.payload?.section === 'string' ? request.payload.section : undefined;
      const control =
        typeof request.payload?.control === 'string' ? request.payload.control : undefined;
      if (
        ['import-data', 'export-data', 'create-backup', 'create-debug-bundle'].includes(
          request.command
        )
      ) {
        if (!hasPermission('backup:read'))
          return {
            accepted: false,
            message: 'Backup read permission is required to open Maintenance.',
          };
        section = 'maintenance';
      } else if (request.command === 'test-squad-webhook') section = 'notifications';
      else if (request.command !== 'open-settings')
        return { accepted: false, message: 'Use the main window for this action.' };
      flushSync(() => setTarget({ section: section ?? target.section ?? 'general', control }));
      return { accepted: true };
    });
  }, [allowed, hasPermission, isLoading, writer, target.section]);

  if (!allowed)
    return (
      <main className="p-6" role="alert">
        Settings read permission is required.
      </main>
    );
  return (
    <SettingsDialog
      open
      presentation="window"
      onOpenChange={(open) => {
        if (!open) window.close();
      }}
      defaultTab={target.section}
      defaultControl={target.control}
    />
  );
}
