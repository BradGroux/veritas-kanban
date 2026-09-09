import type {
  DesktopCommandDispatchRequest,
  DesktopCommandDispatchResult,
} from '@veritas-kanban/shared';

export function desktopSettingsBridge() {
  return (
    window as Window & {
      veritasDesktop?: {
        getAppInfo?: () => Promise<{ platform: string }>;
        dispatchCommand?: (
          request: DesktopCommandDispatchRequest
        ) => Promise<DesktopCommandDispatchResult>;
        onMenuCommand?: (
          listener: (
            request: DesktopCommandDispatchRequest
          ) =>
            | { accepted: boolean; message?: string }
            | Promise<{ accepted: boolean; message?: string }>
        ) => () => void;
      };
    }
  ).veritasDesktop;
}

export function isNativeSettingsWindow() {
  return (
    Boolean(desktopSettingsBridge()) &&
    new URLSearchParams(window.location.search).get('desktop-settings') === '1'
  );
}
