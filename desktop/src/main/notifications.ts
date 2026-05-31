import type { Notification as ElectronNotificationConstructor } from 'electron';

import type {
  DesktopNotificationAction,
  DesktopNotificationActionRequest,
} from '../shared/desktop-bridge-contracts.js';

export type DesktopNotificationKind =
  | 'mention'
  | 'approval'
  | 'blocked-workflow'
  | 'agent-complete'
  | 'failed-run'
  | 'update-available'
  | 'setup-test';

export interface DesktopNotificationRequest {
  id: string;
  kind: DesktopNotificationKind;
  title: string;
  body: string;
  target?: {
    type:
      | 'task'
      | 'run'
      | 'workflow-gate'
      | 'approval'
      | 'settings'
      | 'maintenance'
      | 'work-product';
    id?: string;
  };
  dedupeKey?: string;
  privacyMode?: 'full' | 'private';
}

export interface DesktopNotificationPreview {
  id: string;
  title: string;
  body: string;
  dedupeKey: string;
  target?: DesktopNotificationRequest['target'];
}

export interface DesktopNotificationAdapter {
  show(preview: DesktopNotificationPreview, onClick: () => void): void;
}

export class ElectronNotificationAdapter implements DesktopNotificationAdapter {
  constructor(private readonly NotificationCtor: typeof ElectronNotificationConstructor) {}

  show(preview: DesktopNotificationPreview, onClick: () => void): void {
    if (!this.NotificationCtor.isSupported()) {
      return;
    }

    const notification = new this.NotificationCtor({
      title: preview.title,
      body: preview.body,
    });
    notification.once('click', onClick);
    notification.show();
  }
}

export class DesktopNotificationCenter {
  private readonly displayed = new Set<string>();

  constructor(
    private readonly adapter: DesktopNotificationAdapter,
    private readonly dispatchAction: (request: DesktopNotificationActionRequest) => void
  ) {}

  show(request: DesktopNotificationRequest): DesktopNotificationPreview | null {
    const preview = createNotificationPreview(request);
    if (this.displayed.has(preview.dedupeKey)) {
      return null;
    }

    this.displayed.add(preview.dedupeKey);
    this.adapter.show(preview, () => {
      this.dispatchAction({
        notificationId: preview.id,
        action: 'open',
        taskId: preview.target?.type === 'task' ? preview.target.id : undefined,
      });
    });
    return preview;
  }

  markRead(notificationId: string, action: DesktopNotificationAction = 'dismiss'): void {
    this.dispatchAction({
      notificationId,
      action,
    });
  }
}

export function createNotificationPreview(
  request: DesktopNotificationRequest
): DesktopNotificationPreview {
  const privateMode = request.privacyMode === 'private';
  return {
    id: request.id,
    title: privateMode ? privacyTitle(request.kind) : request.title,
    body: privateMode ? 'Open Veritas Kanban to view details.' : request.body,
    dedupeKey: request.dedupeKey ?? `${request.kind}:${request.id}`,
    target: request.target,
  };
}

function privacyTitle(kind: DesktopNotificationKind): string {
  switch (kind) {
    case 'mention':
      return 'New mention';
    case 'approval':
      return 'Approval requested';
    case 'blocked-workflow':
      return 'Workflow blocked';
    case 'agent-complete':
      return 'Agent run completed';
    case 'failed-run':
      return 'Run failed';
    case 'update-available':
      return 'Update available';
    case 'setup-test':
      return 'Veritas Kanban notification test';
  }
}
