import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { ConfigService } from '../services/config-service.js';
import { DEFAULT_FEATURE_SETTINGS } from '@veritas-kanban/shared';

describe('ConfigService', () => {
  let service: ConfigService;
  let testRoot: string;
  let configDir: string;
  let configFile: string;

  beforeEach(async () => {
    // Create fresh test directories with unique suffix
    const uniqueSuffix = Math.random().toString(36).substring(7);
    testRoot = path.join(os.tmpdir(), `veritas-test-config-${uniqueSuffix}`);
    configDir = path.join(testRoot, '.veritas-kanban');
    configFile = path.join(configDir, 'config.json');
    
    await fs.mkdir(configDir, { recursive: true });
    
    service = new ConfigService({
      configDir,
      configFile,
    });
  });

  afterEach(async () => {
    // Dispose watcher before removing test directories
    service.dispose();
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('Feature Settings', () => {
    it('should return defaults when no config exists', async () => {
      const features = await service.getFeatureSettings();
      
      expect(features).toEqual(DEFAULT_FEATURE_SETTINGS);
      expect(features.board).toBeDefined();
      expect(features.tasks).toBeDefined();
      expect(features.agents).toBeDefined();
    });

    it('should create config file with defaults on first access', async () => {
      await service.getConfig();
      
      const exists = await fs.access(configFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      const content = await fs.readFile(configFile, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.features).toEqual(DEFAULT_FEATURE_SETTINGS);
    });

    it('should perform deep merge on PATCH', async () => {
      // First get config to create defaults
      await service.getConfig();
      
      // Patch a nested value
      const updated = await service.updateFeatureSettings({
        board: {
          showDashboard: false,
        },
      });
      
      // Should preserve other board settings
      expect(updated.board.showDashboard).toBe(false);
      expect(updated.board.showArchiveSuggestions).toBe(DEFAULT_FEATURE_SETTINGS.board.showArchiveSuggestions);
      expect(updated.board.cardDensity).toBe(DEFAULT_FEATURE_SETTINGS.board.cardDensity);
      
      // Should preserve other top-level features
      expect(updated.tasks).toEqual(DEFAULT_FEATURE_SETTINGS.tasks);
      expect(updated.agents).toEqual(DEFAULT_FEATURE_SETTINGS.agents);
    });

    it('should apply defaults for missing keys on load', async () => {
      // Write partial config
      const partialConfig = {
        repos: [],
        agents: [],
        features: {
          board: {
            showDashboard: false,
          },
        },
      };
      
      await fs.writeFile(configFile, JSON.stringify(partialConfig, null, 2));
      
      // Force reload
      const config = await service.getConfig();
      
      // Should merge with defaults
      expect(config.features.board.showDashboard).toBe(false);
      expect(config.features.board.showArchiveSuggestions).toBe(DEFAULT_FEATURE_SETTINGS.board.showArchiveSuggestions);
      expect(config.features.board.cardDensity).toBe(DEFAULT_FEATURE_SETTINGS.board.cardDensity);
      expect(config.features.tasks).toEqual(DEFAULT_FEATURE_SETTINGS.tasks);
    });

    it('should handle multiple sequential patches', async () => {
      await service.getConfig();
      
      // First patch
      await service.updateFeatureSettings({
        board: { showDashboard: false },
      });
      
      // Second patch
      const updated = await service.updateFeatureSettings({
        tasks: { enableTimeTracking: false },
      });
      
      // Both patches should be preserved
      expect(updated.board.showDashboard).toBe(false);
      expect(updated.tasks.enableTimeTracking).toBe(false);
    });

    it('should handle deeply nested patch objects', async () => {
      await service.getConfig();
      
      const updated = await service.updateFeatureSettings({
        agents: {
          timeoutMinutes: 60,
          autoCommitOnComplete: true,
        },
      });
      
      expect(updated.agents.timeoutMinutes).toBe(60);
      expect(updated.agents.autoCommitOnComplete).toBe(true);
      expect(updated.agents.autoCleanupWorktrees).toBe(DEFAULT_FEATURE_SETTINGS.agents.autoCleanupWorktrees);
      expect(updated.agents.enablePreview).toBe(DEFAULT_FEATURE_SETTINGS.agents.enablePreview);
    });

    it('should persist settings across service instances', async () => {
      // First instance
      await service.updateFeatureSettings({
        board: { cardDensity: 'compact' },
      });
      
      // Create new instance pointing to same config
      const newService = new ConfigService({
        configDir,
        configFile,
      });
      
      const features = await newService.getFeatureSettings();
      expect(features.board.cardDensity).toBe('compact');
    });
  });

  describe('Config Service - General', () => {
    it('should handle missing config directory gracefully', async () => {
      // Delete the config directory
      await fs.rm(configDir, { recursive: true, force: true });
      
      // Should recreate on access
      const config = await service.getConfig();
      expect(config).toBeDefined();
      
      const exists = await fs.access(configDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should include default agents in new config', async () => {
      const config = await service.getConfig();
      
      expect(config.agents).toBeDefined();
      expect(config.agents.length).toBeGreaterThan(0);
      expect(config.agents.some(a => a.type === 'claude-code')).toBe(true);
    });

    it('should set default agent', async () => {
      const config = await service.getConfig();
      expect(config.defaultAgent).toBe('claude-code');
    });
  });

  describe('Error Handling', () => {
    it('should throw on corrupted config file', async () => {
      // Write invalid JSON
      await fs.writeFile(configFile, '{ invalid json }');
      
      await expect(service.getConfig()).rejects.toThrow();
    });

    it('should handle concurrent reads', async () => {
      // Multiple simultaneous reads
      const promises = [
        service.getConfig(),
        service.getConfig(),
        service.getConfig(),
      ];
      
      const results = await Promise.all(promises);
      
      // All should return the same config
      expect(results[0]).toEqual(results[1]);
      expect(results[1]).toEqual(results[2]);
    });
  });

  describe('Cache Behavior', () => {
    it('should return cached config within TTL', async () => {
      // First read populates cache
      const config1 = await service.getConfig();
      
      // Modify file on disk behind the service's back
      const raw = JSON.parse(await fs.readFile(configFile, 'utf-8'));
      raw.defaultAgent = 'amp';
      // Mark as our own write so the file watcher ignores it,
      // simulating a read within the TTL window
      (service as any).lastWriteTime = Date.now();
      await fs.writeFile(configFile, JSON.stringify(raw, null, 2));
      
      // Should still return the cached version (TTL hasn't expired)
      const config2 = await service.getConfig();
      expect(config2.defaultAgent).toBe(config1.defaultAgent);
    });

    it('should re-read from disk after invalidateCache()', async () => {
      const config1 = await service.getConfig();
      expect(config1.defaultAgent).toBe('claude-code');

      // Modify file on disk
      const raw = JSON.parse(await fs.readFile(configFile, 'utf-8'));
      raw.defaultAgent = 'amp';
      // Suppress watcher for this manual write
      (service as any).lastWriteTime = Date.now();
      await fs.writeFile(configFile, JSON.stringify(raw, null, 2));

      // Explicitly invalidate
      service.invalidateCache();

      const config2 = await service.getConfig();
      expect(config2.defaultAgent).toBe('amp');
    });

    it('should update cache on saveConfig without re-reading disk', async () => {
      const config = await service.getConfig();
      config.defaultAgent = 'gemini';
      await service.saveConfig(config);

      // Should return updated value from cache, not disk
      const config2 = await service.getConfig();
      expect(config2.defaultAgent).toBe('gemini');
    });

    it('should clean up watcher on dispose()', async () => {
      await service.getConfig(); // triggers watcher setup
      service.dispose();
      // After dispose, cache should be cleared
      expect((service as any).config).toBeNull();
      expect((service as any).watcher).toBeNull();
    });
  });
});
