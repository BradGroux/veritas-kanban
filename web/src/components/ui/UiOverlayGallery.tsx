import { useState } from 'react';
import { Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { UiAction, UiSurface, UiSectionHeading } from './UiVocabulary';
import { UiModal, OverlayFooter, OVERLAY_VARIANTS, type OverlayVariant } from './UiOverlay';

export function UiOverlayGallery() {
  const [variant, setVariant] = useState<OverlayVariant | null>(null);
  const [confirm, setConfirm] = useState(false);
  return (
    <UiSurface level="section">
      <UiSectionHeading
        title="Popout geometry"
        description="16px body/footer insets and section gaps; 56px minimum header; 34px close target. Values scale with text size."
      />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} mt="md">
        {(Object.keys(OVERLAY_VARIANTS) as OverlayVariant[]).map((name) => (
          <UiSurface key={name} p="md">
            <Text fw={650}>{name}</Text>
            <Text size="sm">
              {OVERLAY_VARIANTS[name].width} maximum width · {OVERLAY_VARIANTS[name].presentation}
            </Text>
            <UiAction mt="sm" variant="secondary" onClick={() => setVariant(name)}>
              Inspect {name}
            </UiAction>
          </UiSurface>
        ))}
      </SimpleGrid>
      <UiModal
        opened={variant !== null}
        onClose={() => setVariant(null)}
        variant={variant ?? 'form'}
        title={`${variant} popout`}
        compound
        styles={{ content: { height: 'min(40rem, calc(100dvh - 2rem))' } }}
      >
        <Stack
          className="vk-overlay-scroll"
          gap="1rem"
          data-testid="overlay-gallery-scroll"
          tabIndex={0}
        >
          <TextInput label="First field" placeholder="Keyboard focus starts here" data-autofocus />
          <Select label="Example selector" data={['Alpha', 'Beta']} placeholder="Choose a value" />
          <Text>
            Body inset: 1rem. Section gap: 1rem. One primary scroll region; actions remain
            reachable.
          </Text>
          {Array.from({ length: 12 }, (_, index) => (
            <UiSurface key={index} p="md">
              <Text>Section {index + 1}</Text>
              <Text size="sm" c="dimmed">
                Resize the window and increase text size to inspect bounded content.
              </Text>
            </UiSurface>
          ))}
        </Stack>
        <OverlayFooter>
          <UiAction variant="secondary" onClick={() => setVariant(null)}>
            Cancel
          </UiAction>
          <UiAction onClick={() => setConfirm(true)}>Review action</UiAction>
        </OverlayFooter>
        <UiModal
          opened={confirm}
          onClose={() => setConfirm(false)}
          variant="confirm"
          title="Confirm example"
        >
          <Text>No data changes. Escape returns to the parent.</Text>
          <UiAction mt="md" onClick={() => setConfirm(false)}>
            Return to popout
          </UiAction>
        </UiModal>
      </UiModal>
    </UiSurface>
  );
}
