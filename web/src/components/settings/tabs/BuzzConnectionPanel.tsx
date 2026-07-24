import {
  Badge,
  Button,
  Code,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CommunicationAdapterInput, type CommunicationAdapterRecord } from '@/lib/api';
import { SectionHeader, ToggleRow } from '../shared';

const BUZZ_ADAPTER_ID = 'buzz-default';

interface BuzzFormState {
  enabled: boolean;
  relayHttpUrl: string;
  relayWebSocketUrl: string;
  expectedCommunity: string;
  publicKey: string;
  credentialRef: string;
  authTagRef: string;
  commandExecutable: string;
  commandArgs: string[];
  allowLocalhost: boolean;
  allowPrivateNetwork: boolean;
}

function adapterToForm(adapter?: CommunicationAdapterRecord): BuzzFormState {
  return {
    enabled: adapter?.enabled ?? false,
    relayHttpUrl: adapter?.relayHttpUrl ?? '',
    relayWebSocketUrl: adapter?.relayWebSocketUrl ?? '',
    expectedCommunity: adapter?.expectedCommunity ?? '',
    publicKey: adapter?.publicKey ?? '',
    credentialRef: adapter?.credentialRef ?? 'env:BUZZ_PRIVATE_KEY',
    authTagRef: adapter?.authTagRef ?? '',
    commandExecutable: adapter?.command?.executable ?? '',
    commandArgs: adapter?.command?.args ?? [],
    allowLocalhost: adapter?.allowLocalhost ?? false,
    allowPrivateNetwork: adapter?.allowPrivateNetwork ?? false,
  };
}

function formToInput(form: BuzzFormState): CommunicationAdapterInput {
  return {
    kind: 'buzz',
    enabled: form.enabled,
    displayName: 'Buzz',
    relayHttpUrl: form.relayHttpUrl,
    relayWebSocketUrl: form.relayWebSocketUrl || null,
    expectedCommunity: form.expectedCommunity || null,
    publicKey: form.publicKey,
    credentialRef: form.credentialRef,
    authTagRef: form.authTagRef || null,
    command: form.commandExecutable
      ? {
          executable: form.commandExecutable,
          args: form.commandArgs.length ? form.commandArgs : undefined,
        }
      : null,
    allowLocalhost: form.allowLocalhost,
    allowPrivateNetwork: form.allowPrivateNetwork,
  };
}

function healthColor(status?: string): string {
  if (status === 'healthy') return 'green';
  if (status === 'degraded' || status === 'warning') return 'yellow';
  if (!status || status === 'disabled') return 'gray';
  return 'red';
}

function verificationColor(state?: string): string {
  if (state === 'verified') return 'green';
  if (state === 'not_enforced') return 'blue';
  if (state === 'failed') return 'red';
  return 'gray';
}

export function BuzzConnectionPanel() {
  const queryClient = useQueryClient();
  const { data: adapters = [] } = useQuery({
    queryKey: ['integrations', 'communication', 'adapters'],
    queryFn: api.integrations.communicationAdapters,
    staleTime: 30_000,
    retry: false,
  });
  const adapter = adapters.find((candidate) => candidate.id === BUZZ_ADAPTER_ID);
  const { data: health } = useQuery({
    queryKey: ['integrations', 'communication', 'health', BUZZ_ADAPTER_ID],
    queryFn: () => api.integrations.communicationHealth(BUZZ_ADAPTER_ID),
    enabled: Boolean(adapter),
    staleTime: 30_000,
    retry: false,
  });
  const effectiveHealth = health ?? adapter?.lastHealth;
  const compatibility = effectiveHealth?.buzz ?? adapter?.compatibility;
  const [form, setForm] = useState<BuzzFormState>(() => adapterToForm(adapter));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setForm(adapterToForm(adapter));
  }, [adapter, dirty]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['integrations', 'communication'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.integrations.configureCommunicationAdapter(BUZZ_ADAPTER_ID, formToInput(form)),
    onSuccess: () => {
      setDirty(false);
      invalidate();
    },
  });
  const test = useMutation({
    mutationFn: () => api.integrations.testCommunicationAdapter(BUZZ_ADAPTER_ID),
    onSuccess: invalidate,
  });
  const disconnect = useMutation({
    mutationFn: () => api.integrations.disconnectCommunicationAdapter(BUZZ_ADAPTER_ID),
    onSuccess: () => {
      setDirty(false);
      invalidate();
    },
  });

  const update = <K extends keyof BuzzFormState>(key: K, value: BuzzFormState[K]) => {
    setDirty(true);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const error = save.error || test.error || disconnect.error;
  const verificationSteps = [
    ['Relay', compatibility?.checks.relayIdentity],
    ['Community binding', compatibility?.checks.communityBinding],
    ['Configured identity', compatibility?.checks.configuredIdentity],
    ['Authentication', compatibility?.checks.authentication],
    ['Membership', compatibility?.checks.membership],
    [
      'Read paths',
      compatibility?.checks.channelRead === 'verified' &&
      compatibility?.checks.messageRead === 'verified'
        ? 'verified'
        : compatibility?.checks.channelRead === 'failed' ||
            compatibility?.checks.messageRead === 'failed'
          ? 'failed'
          : 'unverified',
    ],
  ] as const;

  return (
    <div className="space-y-4">
      <SectionHeader title="Buzz Connection" />
      <p className="text-sm text-muted-foreground -mt-2">
        Verify Buzz relay identity, NIP-98 authentication, membership, and read capability without
        sending a message
      </p>
      <Paper withBorder radius="md" p="sm">
        <Stack gap="sm">
          <Group justify="space-between" gap="sm" align="flex-start">
            <div>
              <Text size="sm" fw={600}>
                Read-only compatibility
              </Text>
              <Text size="xs" c="dimmed">
                {effectiveHealth?.detail ??
                  'Save a reference-only connection to enable compatibility diagnostics.'}
              </Text>
            </div>
            <Badge color={healthColor(effectiveHealth?.status)} variant="light" tt="none">
              {effectiveHealth?.status ?? (adapter ? 'not checked' : 'not configured')}
            </Badge>
          </Group>

          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <TextInput
              label="Relay HTTP URL"
              value={form.relayHttpUrl}
              onChange={(event) => update('relayHttpUrl', event.target.value)}
              placeholder="https://community.example.com"
              type="url"
              required
              size="xs"
            />
            <TextInput
              label="Relay WebSocket URL"
              value={form.relayWebSocketUrl}
              onChange={(event) => update('relayWebSocketUrl', event.target.value)}
              placeholder="Derived from the HTTP URL when omitted"
              type="url"
              size="xs"
            />
            <TextInput
              label="Expected community"
              value={form.expectedCommunity}
              onChange={(event) => update('expectedCommunity', event.target.value)}
              placeholder="community.example.com"
              size="xs"
            />
            <TextInput
              label="Public key"
              value={form.publicKey}
              onChange={(event) => update('publicKey', event.target.value)}
              placeholder="64-character Nostr public key hex"
              required
              size="xs"
            />
            <TextInput
              label="Signing key reference"
              value={form.credentialRef}
              onChange={(event) => update('credentialRef', event.target.value)}
              placeholder="env:BUZZ_PRIVATE_KEY"
              description="Environment reference only. The private key is never stored here."
              required
              size="xs"
            />
            <TextInput
              label="NIP-OA auth tag reference"
              value={form.authTagRef}
              onChange={(event) => update('authTagRef', event.target.value)}
              placeholder="env:BUZZ_AUTH_TAG"
              description="Optional environment reference for delegated agent membership."
              size="xs"
            />
            <TextInput
              label="Buzz command"
              value={form.commandExecutable}
              onChange={(event) => update('commandExecutable', event.target.value)}
              placeholder="Optional executable path"
              description="Optional version diagnostic. Veritas never invokes a shell."
              size="xs"
            />
          </SimpleGrid>

          <ToggleRow
            label="Enable Buzz diagnostics"
            description="Allow read-only relay and identity probes. Message delivery remains disabled."
            checked={form.enabled}
            onCheckedChange={(value) => update('enabled', value)}
          />
          <ToggleRow
            label="Allow localhost relay"
            description="Explicitly permit loopback endpoints for local Buzz development."
            checked={form.allowLocalhost}
            onCheckedChange={(value) => update('allowLocalhost', value)}
          />
          <ToggleRow
            label="Allow private-network relay"
            description="Explicitly permit RFC1918 or IPv6 ULA destinations. Link-local and metadata ranges remain blocked."
            checked={form.allowPrivateNetwork}
            onCheckedChange={(value) => update('allowPrivateNetwork', value)}
          />

          <Paper withBorder radius="sm" p="xs">
            <Text size="xs" fw={600} mb={6}>
              Compatibility chain
            </Text>
            <SimpleGrid
              cols={{ base: 2, sm: 6 }}
              spacing={4}
              aria-label="Buzz compatibility verification chain"
            >
              {verificationSteps.map(([label, state]) => (
                <Paper key={label} withBorder radius="xs" p={6}>
                  <Text size="xs" fw={600}>
                    {label}
                  </Text>
                  <Badge
                    color={verificationColor(state)}
                    variant="light"
                    size="xs"
                    tt="none"
                    mt={3}
                  >
                    {state ?? 'unverified'}
                  </Badge>
                </Paper>
              ))}
            </SimpleGrid>
          </Paper>

          <Paper withBorder radius="sm" p="xs">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={4}>
              <Text size="xs">
                Signing reference:{' '}
                <Code>{adapter?.credentialRef ? 'configured' : 'not configured'}</Code>
              </Text>
              <Text size="xs">
                Auth-tag reference:{' '}
                <Code>{adapter?.authTagConfigured ? 'configured' : 'not configured'}</Code>
              </Text>
              <Text size="xs">
                Community:{' '}
                <Code>
                  {compatibility?.expectedCommunity ?? adapter?.expectedCommunity ?? 'not set'} →{' '}
                  {compatibility?.observedCommunity ?? 'not observed'}
                </Code>
              </Text>
              <Text size="xs">
                Public-key fingerprint:{' '}
                <Code>
                  {compatibility?.publicKeyFingerprint ?? adapter?.publicKeyFingerprint ?? 'n/a'}
                </Code>
              </Text>
              <Text size="xs">
                Tested contract:{' '}
                <Code>
                  {compatibility
                    ? `Buzz ${compatibility.testedRelease}, probe ${compatibility.probeRevision}`
                    : 'not checked'}
                </Code>
              </Text>
              <Text size="xs">
                Last check:{' '}
                <Code>
                  {effectiveHealth?.checkedAt
                    ? new Date(effectiveHealth.checkedAt).toLocaleString()
                    : 'not checked'}
                </Code>
              </Text>
            </SimpleGrid>
            {effectiveHealth?.reasonCode && effectiveHealth.reasonCode !== 'ok' && (
              <Text size="xs" c="red" mt="xs">
                {effectiveHealth.reasonCode}:{' '}
                {effectiveHealth.remediation ?? effectiveHealth.detail}
              </Text>
            )}
            {compatibility?.commands.length ? (
              <Text size="xs" c="dimmed" mt="xs">
                Commands:{' '}
                {compatibility.commands
                  .map(
                    (command) =>
                      `${command.command}=${command.available ? command.version : 'not found'}`
                  )
                  .join(', ')}
              </Text>
            ) : null}
          </Paper>

          <Group justify="flex-end" gap="xs">
            <Button
              type="button"
              size="xs"
              variant="light"
              color="gray"
              onClick={() => test.mutate()}
              disabled={!adapter || test.isPending || save.isPending}
            >
              Test Connection
            </Button>
            <Button
              type="button"
              size="xs"
              variant="light"
              color="red"
              onClick={() => disconnect.mutate()}
              disabled={!adapter || disconnect.isPending}
            >
              Disable
            </Button>
            <Button type="button" size="xs" onClick={() => save.mutate()} disabled={save.isPending}>
              Save Buzz
            </Button>
          </Group>
          {error && (
            <Text size="xs" c="red">
              {error.message}
            </Text>
          )}
        </Stack>
      </Paper>
    </div>
  );
}
