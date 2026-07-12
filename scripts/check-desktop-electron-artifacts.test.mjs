import assert from 'node:assert/strict';
import test from 'node:test';

import { validateElectronArtifact } from './check-desktop-electron-artifacts.mjs';

test('accepts named Electron runtime API imports in the main artifact', () => {
  const source = 'import { app, BrowserWindow, shell } from "electron"; app.whenReady();';

  assert.deepEqual(validateElectronArtifact(source, ['app', 'BrowserWindow']), []);
});

test('accepts Electron namespace access in the CommonJS preload artifact', () => {
  const source =
    'const electron = require("electron"); electron.contextBridge.exposeInMainWorld("api", {}); electron.ipcRenderer.send("ready");';

  assert.deepEqual(validateElectronArtifact(source, ['contextBridge', 'ipcRenderer']), []);
});

test('rejects unrelated local symbols even when Electron is imported for side effects', () => {
  const source = 'import "electron"; const app = {}; const BrowserWindow = class {};';
  const errors = validateElectronArtifact(source, ['app', 'BrowserWindow']);

  assert.ok(errors.some((error) => error.includes('does not import')));
  assert.ok(errors.some((error) => error.includes('app from Electron')));
  assert.ok(errors.some((error) => error.includes('BrowserWindow from Electron')));
});

test('rejects the bundled Electron installer shim even with valid-looking bindings', () => {
  const source =
    'import { app, BrowserWindow } from "electron"; console.log("Downloading Electron binary...");';
  const errors = validateElectronArtifact(source, ['app', 'BrowserWindow']);

  assert.ok(errors.some((error) => error.includes('installer shim')));
});
