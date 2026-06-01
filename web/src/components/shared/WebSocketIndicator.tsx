import { Box, Group, Popover, Text, UnstyledButton } from '@mantine/core';
import { useWebSocketStatus } from '@/contexts/WebSocketContext';
import { Wifi, WifiOff, RefreshCw } from 'lucide-react';

/**
 * Tiny indicator showing WebSocket connection status.
 * Green dot + wifi icon  = connected (real-time updates active)
 * Yellow dot + spinner   = reconnecting (trying to restore connection)
 * Red dot + wifi-off     = disconnected (gave up or not started)
 *
 * Click to see a brief explanation of what it means.
 */
export function WebSocketIndicator() {
  const { connectionState, reconnectAttempt } = useWebSocketStatus();

  const isConnected = connectionState === 'connected';
  const isReconnecting = connectionState === 'reconnecting' || connectionState === 'connecting';

  // Dot color
  const dotClass = isConnected
    ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]'
    : isReconnecting
      ? 'bg-yellow-500 shadow-[0_0_4px_rgba(234,179,8,0.5)] animate-pulse'
      : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]';

  // Icon
  const Icon = isConnected ? Wifi : isReconnecting ? RefreshCw : WifiOff;
  const iconColor = isConnected
    ? 'text-green-500'
    : isReconnecting
      ? 'text-yellow-500'
      : 'text-red-500';
  const iconClass = isReconnecting ? `${iconColor} animate-spin` : iconColor;

  // Label
  const label = isConnected
    ? 'WebSocket connected'
    : isReconnecting
      ? `WebSocket reconnecting (attempt ${reconnectAttempt})`
      : 'WebSocket disconnected';

  // Popover heading
  const heading = isConnected
    ? 'Real-time sync active'
    : isReconnecting
      ? 'Reconnecting…'
      : 'Connection lost';

  // Popover body
  const body = isConnected
    ? 'Board updates are delivered instantly via WebSocket. Changes from agents and other tabs appear in real time.'
    : isReconnecting
      ? `Attempting to restore the WebSocket connection (attempt ${reconnectAttempt}). The board is polling the server for updates in the meantime.`
      : 'Could not establish a WebSocket connection after multiple attempts. The board is polling the server every 10 seconds for updates. Refresh the page to try again.';

  return (
    <Popover position="bottom-end">
      <Popover.Target>
        <UnstyledButton
          className="flex min-h-8 min-w-8 items-center justify-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground cursor-pointer select-none transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={label}
        >
          <Box component="span" className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
          <Icon className={`h-3 w-3 ${iconClass}`} aria-hidden="true" />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown className="w-64 bg-popover p-3 text-popover-foreground">
        <Box className="space-y-1.5">
          <Group gap="xs" wrap="nowrap">
            <Icon className={`h-4 w-4 ${iconColor} shrink-0`} />
            <Text size="sm" fw={500}>
              {heading}
            </Text>
          </Group>
          <Text size="xs" c="dimmed" lh="sm">
            {body}
          </Text>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}
