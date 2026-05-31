import { useEffect, type ReactNode } from 'react';
import {
  MantineProvider,
  type MantineColorScheme,
  type MantineColorSchemeManager,
  localStorageColorSchemeManager,
  useComputedColorScheme,
} from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { veritasMantineTheme } from './mantine-theme';
import {
  applyVeritasColorScheme,
  normalizeVeritasColorScheme,
  VERITAS_COLOR_SCHEME_STORAGE_KEY,
} from './color-scheme';

export const veritasColorSchemeManager = localStorageColorSchemeManager({
  key: VERITAS_COLOR_SCHEME_STORAGE_KEY,
});

let testColorScheme: MantineColorScheme = 'dark';

export const testColorSchemeManager: MantineColorSchemeManager = {
  get: (defaultValue) => testColorScheme ?? defaultValue,
  set: (value) => {
    testColorScheme = value;
  },
  subscribe: () => {},
  unsubscribe: () => {},
  clear: () => {
    testColorScheme = 'dark';
  },
};

interface MantineRootProps {
  children: ReactNode;
  env?: 'default' | 'test';
}

function VeritasColorSchemeSync() {
  const computedColorScheme = useComputedColorScheme('dark', {
    getInitialValueInEffect: true,
  });

  useEffect(() => {
    applyVeritasColorScheme(normalizeVeritasColorScheme(computedColorScheme));
  }, [computedColorScheme]);

  return null;
}

function VeritasTestColorSchemeSync() {
  useEffect(() => {
    applyVeritasColorScheme('dark');
  }, []);

  return null;
}

export function MantineRoot({ children, env = 'default' }: MantineRootProps) {
  return (
    <MantineProvider
      theme={veritasMantineTheme}
      colorSchemeManager={env === 'test' ? testColorSchemeManager : veritasColorSchemeManager}
      defaultColorScheme="dark"
      env={env}
    >
      {env === 'test' ? <VeritasTestColorSchemeSync /> : <VeritasColorSchemeSync />}
      <ModalsProvider>
        {children}
        <Notifications position="bottom-right" limit={5} zIndex={5000} />
      </ModalsProvider>
    </MantineProvider>
  );
}
