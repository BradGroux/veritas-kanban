import * as React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import { renderWithProviders } from './test-utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/hooks/useToast';

const originalScrollIntoView = Element.prototype.scrollIntoView;

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

function TabsProbe() {
  const [selectedTab, setSelectedTab] = React.useState('summary');

  return (
    <Tabs value={selectedTab} onValueChange={setSelectedTab}>
      <TabsList>
        <TabsTrigger value="summary">Summary</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="summary">Summary content</TabsContent>
      <TabsContent value="activity">Activity content</TabsContent>
      <span data-testid="selected-tab">{selectedTab}</span>
    </Tabs>
  );
}

function DialogProbe() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button>Open dialog</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
      <span data-testid="dialog-state">{String(open)}</span>
    </>
  );
}

function SheetProbe() {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button>Open sheet</Button>
        </SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Sheet title</SheetTitle>
          <SheetDescription>Sheet description</SheetDescription>
          <SheetClose asChild>
            <Button>Done</Button>
          </SheetClose>
        </SheetContent>
      </Sheet>
      <span data-testid="sheet-state">{String(open)}</span>
    </>
  );
}

function AlertDialogProbe() {
  const [confirmed, setConfirmed] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button>Open alert</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alert title</AlertDialogTitle>
            <AlertDialogDescription>Alert description</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setConfirmed(true)}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span data-testid="alert-state">{String(open)}</span>
      <span data-testid="alert-confirmed">{String(confirmed)}</span>
    </>
  );
}

function SelectProbe() {
  const [value, setValue] = React.useState('todo');

  return (
    <>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label="Status" className="w-44">
          <SelectValue placeholder="Choose status" />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="todo">To Do</SelectItem>
          <SelectItem value="done">Done</SelectItem>
        </SelectContent>
      </Select>
      <span data-testid="select-state">{value}</span>
    </>
  );
}

describe('Mantine-backed shared UI primitives', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

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
        <Button asChild>
          <a href="/tasks">Open tasks</a>
        </Button>
        <Badge variant="secondary">Ready</Badge>
        <Badge asChild>
          <a href="/status">Status link</a>
        </Badge>
        <Label htmlFor="name">Name</Label>
        <Input id="name" aria-label="Name" placeholder="Task name" />
        <NumberInput aria-label="Estimate" value={3} />
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
    expect(screen.getByRole('link', { name: 'Open tasks' }).getAttribute('data-slot')).toBe(
      'button'
    );
    expect(screen.getByText('Ready').closest('[data-slot="badge"]')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Status link' }).getAttribute('data-slot')).toBe(
      'badge'
    );
    expect(screen.getByLabelText('Name').getAttribute('data-slot')).toBe('input');
    expect(screen.getByLabelText('Estimate').closest('[data-slot="number-input"]')).toBeDefined();
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

  it('preserves tabs value changes through the legacy onValueChange contract', () => {
    renderWithProviders(<TabsProbe />);

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));

    expect(screen.getByTestId('selected-tab').textContent).toBe('activity');
    expect(screen.getByText('Activity content')).toBeDefined();
  });

  it('changes Mantine-backed selects through the legacy value API', async () => {
    renderWithProviders(<SelectProbe />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Done' }));

    await waitFor(() => {
      expect(screen.getByTestId('select-state').textContent).toBe('done');
    });
  });

  it('opens Mantine-backed popovers through the legacy trigger/content API', async () => {
    renderWithProviders(
      <Popover position="bottom-end">
        <PopoverTrigger asChild>
          <Button>Open account menu</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">Account actions</PopoverContent>
      </Popover>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open account menu' }));

    await waitFor(() => {
      expect(screen.getByText('Account actions')).toBeDefined();
      expect(
        screen.getByText('Account actions').closest('[data-slot="popover-content"]')
      ).toBeDefined();
    });
  });

  it('opens Mantine-backed tooltips through the legacy trigger/content API', async () => {
    renderWithProviders(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button>Hover for help</Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Helpful detail</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Hover for help' }));

    await waitFor(() => {
      expect(screen.getByText('Helpful detail')).toBeDefined();
    });
  });

  it('opens and closes Mantine-backed dialogs through the legacy API', async () => {
    renderWithProviders(<DialogProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      const title = screen.getByText('Dialog title');
      const description = screen.getByText('Dialog description');
      const describedBy = dialog.getAttribute('aria-describedby');

      expect(dialog.getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
        description.textContent
      );
      expect(screen.getByTestId('dialog-state').textContent).toBe('true');
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('dialog-state').textContent).toBe('false');
    });
  });

  it('opens and closes Mantine-backed sheets through the legacy API', async () => {
    renderWithProviders(<SheetProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      const title = screen.getByText('Sheet title');
      const description = screen.getByText('Sheet description');
      const describedBy = dialog.getAttribute('aria-describedby');

      expect(dialog.getAttribute('data-side')).toBe('left');
      expect(dialog.getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
        description.textContent
      );
      expect(screen.getByTestId('sheet-state').textContent).toBe('true');
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('sheet-state').textContent).toBe('false');
    });
  });

  it('opens and closes Mantine-backed alert dialogs through the legacy API', async () => {
    renderWithProviders(<AlertDialogProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      const title = screen.getByText('Alert title');
      const description = screen.getByText('Alert description');
      const describedBy = dialog.getAttribute('aria-describedby');

      expect(dialog.getAttribute('aria-labelledby')).toBe(title.getAttribute('id'));
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy ?? '')?.textContent).toContain(
        description.textContent
      );
      expect(screen.getByTestId('alert-state').textContent).toBe('true');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByTestId('alert-state').textContent).toBe('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('alert-state').textContent).toBe('false');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open alert' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(screen.getByTestId('alert-state').textContent).toBe('false');
      expect(screen.getByTestId('alert-confirmed').textContent).toBe('true');
    });
  });
});
