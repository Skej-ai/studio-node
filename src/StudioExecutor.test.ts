/**
 * StudioExecutor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StudioExecutor } from './StudioExecutor.js';
import type { StudioConfig } from './cli/utils/config.js';

// Mock the modules
vi.mock('./cli/utils/config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('./cli/utils/api.js', () => ({
  createApiClient: vi.fn(() => ({
    getPrompt: vi.fn(),
  })),
}));

vi.mock('./executorFactory.js', () => ({
  createExecutor: vi.fn(),
}));

// Mock fs/promises for file loading
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('StudioExecutor', () => {
  const mockConfig: StudioConfig = {
    tenantId: 'test-tenant',
    serviceKey: 'sk-test-key',
    apiUrl: 'https://api.test.com',
    outputDir: './test/prompts',
    apiMode: false,
  };

  const mockCredentials = {
    anthropic: { apiKey: 'test-key' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('create', () => {
    it('should create executor with provided config', async () => {
      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: mockConfig,
      });

      expect(executor).toBeInstanceOf(StudioExecutor);
      expect(executor.getTenantId()).toBe('test-tenant');
    });

    it('should load config from file if not provided', async () => {
      const { loadConfig } = await import('./cli/utils/config.js');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
      });

      expect(loadConfig).toHaveBeenCalled();
      expect(executor).toBeInstanceOf(StudioExecutor);
    });

    it('should throw error if no config found', async () => {
      const { loadConfig } = await import('./cli/utils/config.js');
      vi.mocked(loadConfig).mockResolvedValue(null);

      await expect(
        StudioExecutor.create({ credentials: mockCredentials })
      ).rejects.toThrow('No studio.config.js or studio.config.ts found');
    });

    it('should override tenantId if provided', async () => {
      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: mockConfig,
        tenantId: 'override-tenant',
      });

      expect(executor.getTenantId()).toBe('override-tenant');
    });
  });

  describe('getConfig', () => {
    it('should return config copy', async () => {
      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: mockConfig,
      });

      const config = executor.getConfig();
      expect(config).toEqual(mockConfig);

      // Should be a copy, not same reference
      expect(config).not.toBe(mockConfig);
    });
  });

  describe('execute', () => {
    it('should load from API when apiMode is true', async () => {
      const mockPrompt = {
        promptName: 'test-prompt',
        category: 'test',
        description: 'Test',
        enabled: true,
        systemMessage: 'System',
        userMessage: 'User',
        variables: [],
        toolDefs: [],
        scenarios: [],
        models: [{ provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' }],
        modelSampling: false,
        metadata: {},
        etag: 'test-etag',
        publishedEtag: null,
        publishedVersion: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };

      const { createApiClient } = await import('./cli/utils/api.js');
      const mockClient = {
        exportPrompt: vi.fn().mockResolvedValue({
          data: {
            manifest: mockPrompt,
            exportedAt: '2024-01-01'
          }
        }),
      };
      vi.mocked(createApiClient).mockReturnValue(mockClient as any);

      const { createExecutor } = await import('./executorFactory.js');
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          result: 'test output',
          usage: { inputTokens: 10, outputTokens: 20, totalCostUSD: 0.001 },
          messages: [],
        }),
      };
      vi.mocked(createExecutor).mockResolvedValue(mockExecutor as any);

      const apiModeConfig = { ...mockConfig, apiMode: true };
      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: apiModeConfig,
      });

      const result = await executor.execute('test-prompt', { input: 'test' });

      expect(mockClient.exportPrompt).toHaveBeenCalledWith('test-prompt', false);
      expect(createExecutor).toHaveBeenCalled();
      expect(mockExecutor.execute).toHaveBeenCalled();
      expect(result.result).toBe('test output');
    });

    it('should load from file when apiMode is false', async () => {
      const { createExecutor } = await import('./executorFactory.js');
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          result: 'test output',
          usage: { inputTokens: 10, outputTokens: 20, totalCostUSD: 0.001 },
          messages: [],
        }),
      };
      vi.mocked(createExecutor).mockResolvedValue(mockExecutor as any);

      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: mockConfig,
      });

      // Execute with test-prompt - will load from ../test/prompts/test-prompt.ts
      const result = await executor.execute('test-prompt', { input: 'test' });

      expect(createExecutor).toHaveBeenCalled();
      expect(mockExecutor.execute).toHaveBeenCalled();
      expect(result.result).toBe('test output');
    });

    it('should override apiMode via options', async () => {
      const mockPrompt = {
        promptName: 'test-prompt',
        category: 'test',
        description: 'Test',
        enabled: true,
        systemMessage: 'System',
        userMessage: 'User',
        variables: [],
        toolDefs: [],
        scenarios: [],
        models: [{ provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' }],
        modelSampling: false,
        metadata: {},
        etag: 'test-etag',
        publishedEtag: null,
        publishedVersion: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };

      const { createApiClient } = await import('./cli/utils/api.js');
      const mockClient = {
        exportPrompt: vi.fn().mockResolvedValue({
          data: {
            manifest: mockPrompt,
            exportedAt: '2024-01-01'
          }
        }),
      };
      vi.mocked(createApiClient).mockReturnValue(mockClient as any);

      const { createExecutor } = await import('./executorFactory.js');
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          result: 'test output',
          usage: { inputTokens: 10, outputTokens: 20, totalCostUSD: 0.001 },
          messages: [],
        }),
      };
      vi.mocked(createExecutor).mockResolvedValue(mockExecutor as any);

      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: { ...mockConfig, apiMode: false },
      });

      // Force API mode via options
      await executor.execute('test-prompt', { input: 'test' }, { apiMode: true });

      expect(mockClient.exportPrompt).toHaveBeenCalledWith('test-prompt', false);
    });

    it('should pass tool router to executor', async () => {
      const mockPrompt = {
        promptName: 'test-prompt',
        category: 'test',
        description: 'Test',
        enabled: true,
        systemMessage: 'System',
        userMessage: 'User',
        variables: [],
        toolDefs: [],
        scenarios: [],
        models: [{ provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' }],
        modelSampling: false,
        metadata: {},
        etag: 'test-etag',
        publishedEtag: null,
        publishedVersion: null,
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
      };

      const { createApiClient } = await import('./cli/utils/api.js');
      const mockClient = {
        exportPrompt: vi.fn().mockResolvedValue({
          data: {
            manifest: mockPrompt,
            exportedAt: '2024-01-01'
          }
        }),
      };
      vi.mocked(createApiClient).mockReturnValue(mockClient as any);

      const { createExecutor } = await import('./executorFactory.js');
      const mockExecutor = {
        execute: vi.fn().mockResolvedValue({
          ok: true,
          result: 'test output',
          usage: { inputTokens: 10, outputTokens: 20, totalCostUSD: 0.001 },
          messages: [],
        }),
      };
      vi.mocked(createExecutor).mockResolvedValue(mockExecutor as any);

      const executor = await StudioExecutor.create({
        credentials: mockCredentials,
        config: { ...mockConfig, apiMode: true },
      });

      const toolRouter = vi.fn();

      await executor.execute(
        'test-prompt',
        { input: 'test' },
        { toolRouter }
      );

      const createExecutorCall = vi.mocked(createExecutor).mock.calls[0][0];
      expect(createExecutorCall.toolRouter).toBe(toolRouter);
    });
  });
});
