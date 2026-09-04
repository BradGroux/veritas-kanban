import { Group, Kbd, Stack, Text } from '@mantine/core';
import { OverlayFooter, UiModal as Modal } from '@/components/ui/UiOverlay';
import { Keyboard } from 'lucide-react';
import { useKeyboard } from '@/hooks/useKeyboard';

interface Shortcut {
  keys: string[];
  description: string;
}

const shortcuts: { category: string; items: Shortcut[] }[] = [
  {
    category: 'Navigation',
    items: [
      { keys: ['j', '↓'], description: 'Select next task' },
      { keys: ['k', '↑'], description: 'Select previous task' },
      { keys: ['Enter'], description: 'Open selected task' },
      { keys: ['Esc'], description: 'Close panel / Clear selection' },
    ],
  },
  {
    category: 'Actions',
    items: [
      { keys: ['c'], description: 'Create new task' },
      { keys: ['⌘⇧C'], description: 'Open agent chat' },
      { keys: ['1'], description: 'Move to To Do' },
      { keys: ['2'], description: 'Move to Planning' },
      { keys: ['3'], description: 'Move to In Progress' },
      { keys: ['4'], description: 'Move to Blocked' },
      { keys: ['5'], description: 'Move to Done' },
    ],
  },
  {
    category: 'General',
    items: [{ keys: ['?'], description: 'Toggle this help' }],
  },
];

function KeyBadge({ children }: { children: React.ReactNode }) {
  return (
    <Kbd className="inline-flex min-w-[24px] items-center justify-center px-2 text-xs font-medium">
      {children}
    </Kbd>
  );
}

export function KeyboardShortcutsDialog() {
  const { isHelpOpen, closeHelpDialog } = useKeyboard();

  return (
    <Modal
      opened={isHelpOpen}
      onClose={closeHelpDialog}
      variant="form"
      compound
      title={
        <Group gap="xs">
          <Keyboard className="h-4 w-4" aria-hidden="true" />
          <span>Keyboard Shortcuts</span>
        </Group>
      }
    >
      <Stack gap="md" className="vk-overlay-scroll">
        {shortcuts.map((section) => (
          <section key={section.category} aria-label={`${section.category} shortcuts`}>
            <Text component="h3" size="sm" fw={600} c="dimmed" mb="sm">
              {section.category}
            </Text>
            <dl className="space-y-2">
              {section.items.map((shortcut, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <dt className="text-sm">{shortcut.description}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {shortcut.keys.map((key, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && (
                          <span className="text-muted-foreground text-xs" aria-hidden="true">
                            or
                          </span>
                        )}
                        <KeyBadge>{key}</KeyBadge>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </Stack>
      <OverlayFooter>
        <div className="text-xs text-muted-foreground">
          Press <KeyBadge>Esc</KeyBadge> to close this help
        </div>
      </OverlayFooter>
    </Modal>
  );
}
