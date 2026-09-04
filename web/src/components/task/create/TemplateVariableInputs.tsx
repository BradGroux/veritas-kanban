import { Group, Paper, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import { AlertCircle } from 'lucide-react';

interface TemplateVariableInputsProps {
  disabled?: boolean;
  variables: string[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}

export function TemplateVariableInputs({
  disabled = false,
  variables,
  values,
  onChange,
}: TemplateVariableInputsProps) {
  if (variables.length === 0) {
    return null;
  }

  return (
    <Paper className="bg-muted/30 p-3" radius="md" withBorder>
      <Stack gap="sm">
        <Group gap="xs">
          <ThemeIcon size="sm" color="blue" variant="light">
            <AlertCircle className="h-4 w-4" />
          </ThemeIcon>
          <Text size="sm" fw={500}>
            Template Variables
          </Text>
        </Group>
        {variables.map((varName) => (
          <TextInput
            disabled={disabled}
            key={varName}
            id={`var-${varName}`}
            label={varName}
            value={values[varName] || ''}
            onChange={(e) => onChange(varName, e.currentTarget.value)}
            placeholder={`Enter ${varName}...`}
            size="xs"
          />
        ))}
      </Stack>
    </Paper>
  );
}
