import { useCallback, useEffect } from 'react';
import { useComputedColorScheme, useMantineColorScheme } from '@mantine/core';
import {
  applyVeritasColorScheme,
  normalizeVeritasColorScheme,
  type VeritasColorScheme,
} from '@/theme/color-scheme';

type Theme = VeritasColorScheme;

export function useTheme() {
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('dark', {
    getInitialValueInEffect: true,
  });
  const theme = normalizeVeritasColorScheme(computedColorScheme);

  useEffect(() => {
    applyVeritasColorScheme(theme);
  }, [theme]);

  const setTheme = useCallback(
    (t: Theme) => {
      applyVeritasColorScheme(t);
      setColorScheme(t);
    },
    [setColorScheme]
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  return { theme, setTheme, toggleTheme };
}
