import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const electronRuntimeExternal = ['electron', /^electron\/.+/];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // Vite 8 builds with Rolldown. Electron Vite 5 still places its built-in
      // runtime externals under rollupOptions, which Rolldown does not consume.
      // Keep Electron explicitly external so the emitted main process receives
      // Electron's runtime API instead of bundling the npm executable-path shim.
      rolldownOptions: {
        external: electronRuntimeExternal,
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rolldownOptions: {
        external: electronRuntimeExternal,
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
