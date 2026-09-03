import { AlertTriangle, Check, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';

import {
  UiAction,
  UiEmptyState,
  UiIconAction,
  UiPill,
  UiSectionHeading,
  UiSurface,
} from './UiVocabulary';

const TONES = ['neutral', 'info', 'success', 'warning', 'error', 'blocked', 'selection'] as const;

export function UiVocabularyGallery() {
  return (
    <Stack gap="xl" data-ui-vocabulary-gallery>
      <div>
        <Title order={1}>Desktop UI vocabulary</Title>
        <Text c="dimmed" mt={4}>
          Inspectable production components for actions, surfaces, pills, headings, and semantic
          color.
        </Text>
      </div>

      <UiSurface level="section" component="section" aria-labelledby="gallery-actions">
        <UiSectionHeading
          id="gallery-actions"
          title="Actions"
          description="One hierarchy and one normal desktop height. Labels may grow at increased text sizes."
        />
        <Group mt="md" align="flex-start">
          <UiAction leftSection={<Plus aria-hidden />}>Primary</UiAction>
          <UiAction variant="secondary">Secondary</UiAction>
          <UiAction variant="secondary">
            <Plus className="mr-2" aria-hidden />
            Inline icon
          </UiAction>
          <UiAction variant="quiet">Quiet</UiAction>
          <UiAction variant="destructive" leftSection={<Trash2 aria-hidden />}>
            Destructive
          </UiAction>
          <UiAction disabled>Disabled</UiAction>
          <UiIconAction aria-label="Refresh gallery">
            <RefreshCw aria-hidden />
          </UiIconAction>
        </Group>
      </UiSurface>

      <UiSurface level="section" component="section" aria-labelledby="gallery-pills">
        <UiSectionHeading
          id="gallery-pills"
          title="Pills and semantic color"
          description="Color communicates state or selection; neutral metadata remains neutral."
        />
        <Group mt="md">
          <UiPill>Metadata</UiPill>
          <UiPill kind="count">12 items</UiPill>
          <UiPill kind="selected">Selected</UiPill>
          {TONES.filter((tone) => tone !== 'selection').map((tone) => (
            <UiPill key={tone} kind="status" tone={tone}>
              {tone}
            </UiPill>
          ))}
        </Group>
      </UiSurface>

      <UiSurface level="section" component="section" aria-labelledby="gallery-surfaces">
        <UiSectionHeading
          id="gallery-surfaces"
          title="Surfaces"
          description="Use at most two bordered levels: card, then inset. Empty states use a dashed boundary."
        />
        <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
          <UiSurface level="card" interactive p="md">
            <Text fw={650}>Card</Text>
            <Text size="sm" c="dimmed">
              A primary content group.
            </Text>
            <UiSurface level="inset" p="sm" mt="md">
              <Text size="sm">Inset detail</Text>
            </UiSurface>
          </UiSurface>
          <UiSurface level="card" accent="error" p="md">
            <Text fw={650}>Destructive settings section</Text>
            <Text size="sm">
              A semantic accent for consequential actions, not ordinary grouping.
            </Text>
          </UiSurface>
          <UiEmptyState
            icon={<AlertTriangle aria-hidden />}
            title="No results"
            description="Empty states explain what is missing and offer one useful next action."
            action={
              <UiAction variant="secondary" leftSection={<Check aria-hidden />}>
                Clear filters
              </UiAction>
            }
          />
        </SimpleGrid>
      </UiSurface>
    </Stack>
  );
}
