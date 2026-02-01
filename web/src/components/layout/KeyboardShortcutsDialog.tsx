import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-medium bg-muted border border-border rounded shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsDialog() {
  const { isHelpOpen, closeHelpDialog } = useKeyboard();

  return (
    <Dialog open={isHelpOpen} onOpenChange={(open) => !open && closeHelpDialog()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">⌨️ Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {shortcuts.map((section) => (
            <section key={section.category} aria-label={`${section.category} shortcuts`}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-3">
                {section.category}
              </h3>
              <dl className="space-y-2">
                {section.items.map((shortcut, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <dt className="text-sm">{shortcut.description}</dt>
                    <dd className="flex items-center gap-1">
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
        </div>

        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          Press <KeyBadge>?</KeyBadge> anytime to toggle this help
        </div>
      </DialogContent>
    </Dialog>
  );
}
