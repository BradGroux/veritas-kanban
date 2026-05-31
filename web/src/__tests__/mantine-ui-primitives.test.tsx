import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import { renderWithProviders } from './test-utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/useToast';

function ToggleProbe() {
  const [checked, setChecked] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);

  return (
    <div>
      <Checkbox
        aria-label="Done"
        checked={checked}
        onCheckedChange={(nextChecked) => setChecked(nextChecked === true)}
      />
      <span data-testid="checkbox-state">{String(checked)}</span>

      <Switch
        aria-label="Enabled"
        checked={enabled}
        onCheckedChange={(nextEnabled) => setEnabled(nextEnabled)}
      />
      <span data-testid="switch-state">{String(enabled)}</span>
    </div>
  );
}

function ToastProbe() {
  return (
    <Button
      onClick={() =>
        toast({
          title: 'Saved',
          description: 'Mantine notification bridge is active.',
        })
      }
    >
      Notify
    </Button>
  );
}

describe('Mantine-backed shared UI primitives', () => {
  afterEach(() => {
    notifications.clean();
    cleanup();
  });

  it('renders the common control wrappers through Mantine with legacy data slots', () => {
    renderWithProviders(
      <div>
        <Button>Save</Button>
        <Button size="icon" aria-label="Refresh">
          R
        </Button>
        <Badge variant="secondary">Ready</Badge>
        <Label htmlFor="name">Name</Label>
        <Input id="name" aria-label="Name" placeholder="Task name" />
        <Textarea aria-label="Notes" placeholder="Task notes" />
        <Skeleton data-testid="loading-row" className="h-8 w-full" />
        <ScrollArea data-testid="scroll-area" className="h-24">
          <div>Scrollable content</div>
        </ScrollArea>
      </div>
    );

    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('data-slot')).toBe('button');
    expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('data-slot')).toBe(
      'button'
    );
    expect(screen.getByText('Ready').closest('[data-slot="badge"]')).toBeDefined();
    expect(screen.getByLabelText('Name').getAttribute('data-slot')).toBe('input');
    expect(screen.getByLabelText('Notes')).toBeDefined();
    expect(screen.getByTestId('loading-row').getAttribute('data-slot')).toBe('skeleton');
    expect(screen.getByTestId('scroll-area').getAttribute('data-slot')).toBe('scroll-area');
  });

  it('preserves checkbox and switch onCheckedChange compatibility', () => {
    renderWithProviders(<ToggleProbe />);

    fireEvent.click(screen.getByLabelText('Done'));
    fireEvent.click(screen.getByLabelText('Enabled'));

    expect(screen.getByTestId('checkbox-state').textContent).toBe('true');
    expect(screen.getByTestId('switch-state').textContent).toBe('true');
  });

  it('routes legacy toast calls through Mantine notifications', async () => {
    renderWithProviders(
      <>
        <Toaster />
        <ToastProbe />
      </>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));

    await waitFor(() => {
      expect(screen.getByText('Saved')).toBeDefined();
      expect(screen.getByText('Mantine notification bridge is active.')).toBeDefined();
    });
  });
});
