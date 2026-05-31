import type { VeritasDesktopApi } from '../preload/index.js';

declare global {
  interface Window {
    veritasDesktop?: VeritasDesktopApi;
  }
}

export {};
