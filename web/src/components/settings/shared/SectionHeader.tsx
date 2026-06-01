import { Button, Group, Text } from '@mantine/core';
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
import { RotateCcw } from 'lucide-react';

export function SectionHeader({ title, onReset }: { title: string; onReset?: () => void }) {
  return (
    <Group justify="space-between" align="center" className="mb-2 border-b pb-2">
      <Text size="sm" fw={600} c="dimmed" tt="uppercase">
        {title}
      </Text>
      {onReset && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="subtle"
              size="xs"
              color="gray"
              leftSection={<RotateCcw className="h-3 w-3" />}
            >
              Reset
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset to defaults?</AlertDialogTitle>
              <AlertDialogDescription>
                This will reset all {title.toLowerCase()} settings to their default values.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onReset}>Reset</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </Group>
  );
}
