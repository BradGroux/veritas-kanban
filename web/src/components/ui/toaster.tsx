import * as React from 'react';
import { Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useToast } from '@/hooks/useToast';

export function Toaster() {
  const { toasts, dismiss } = useToast();
  const activeToastIds = React.useRef(new Set<string>());
  const dismissRef = React.useRef(dismiss);

  React.useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);

  React.useEffect(() => {
    const nextIds = new Set(toasts.map((toast) => toast.id));

    for (const id of Array.from(activeToastIds.current)) {
      if (!nextIds.has(id)) {
        notifications.hide(id);
        activeToastIds.current.delete(id);
      }
    }

    for (const toast of toasts) {
      if (toast.open === false) {
        notifications.hide(toast.id);
        activeToastIds.current.delete(toast.id);
        continue;
      }

      const message =
        toast.description || toast.action ? (
          <Stack gap={6}>
            {toast.description ? (
              <Text size="sm" c="dimmed">
                {toast.description}
              </Text>
            ) : null}
            {toast.action}
          </Stack>
        ) : null;

      const notification = {
        id: toast.id,
        title: toast.title,
        message,
        color: toast.variant === 'destructive' ? 'red' : 'veritas',
        autoClose: toast.duration ?? 5000,
        withCloseButton: true,
        onClose: () => dismissRef.current(toast.id),
      };

      if (activeToastIds.current.has(toast.id)) {
        notifications.update(notification);
      } else {
        notifications.show(notification);
      }
      activeToastIds.current.add(toast.id);
    }
  }, [toasts]);

  return null;
}
