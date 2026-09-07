import { useCallback, useEffect } from 'react';
import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import {
  applyVeritasColorScheme,
  normalizeVeritasColorScheme,
  type VeritasThemePreference,
} from '@/theme/color-scheme';

type Theme = VeritasThemePreference;

export function useTheme() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('dark', {
    getInitialValueInEffect: true,
  });
  const theme = normalizeVeritasColorScheme(computedColorScheme);

  useEffect(() => {
    applyVeritasColorScheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme) => {
      if (t !== 'system') applyVeritasColorScheme(t);
      setColorScheme(t === 'system' ? 'auto' : t);
    },
    [setColorScheme]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  return {
    theme,
    preference: colorScheme === 'auto' ? 'system' : colorScheme,
    setTheme,
    toggleTheme,
  };
}
