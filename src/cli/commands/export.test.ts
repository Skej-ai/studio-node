/**
 * Export Command Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exportCommand } from './export.js';
import type { StudioConfig } from '../utils/config.js';

// Mock modules
vi.mock('../utils/config.js', () => ({
  loadConfig: vi.fn(),
  resolveOutputDir: vi.fn(async (dir) => `/resolved/${dir}`),
}));

vi.mock('../utils/api.js', () => ({
  createApiClient: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  mkdtemp: vi.fn(),
  rename: vi.fn(),
  rm: vi.fn(),
}));

describe('Export Command', () => {
  const mockConfig: StudioConfig = {
    tenantId: 'test-tenant',
    serviceKey: 'sk-test',
    apiUrl: 'https://api.test.com',
    outputDir: './test/prompts',
    apiMode: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods to suppress output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export prompts successfully', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    const mockPrompt = {
      promptName: 'test-prompt',
      category: 'test',
      description: 'Test prompt',
      enabled: true,
      systemMessage: 'System',
      userMessage: 'User',
      variables: [],
      toolDefs: [],
      scenarios: [],
      models: [],
      modelSampling: false,
      metadata: {},
      etag: 'test-etag',
      publishedEtag: null,
      publishedVersion: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      listPrompts: vi.fn().mockResolvedValue({
        data: [
          {
            promptName: 'test-prompt',
            category: 'test',
            description: 'Test prompt',
            enabled: true,
            updatedAt: '2024-01-01',
          },
        ],
        page: 1,
        per_page: 50,
        has_more: false,
      }),
      exportPrompt: vi.fn().mockResolvedValue({
        data: {
          manifest: mockPrompt,
          exportedAt: '2024-01-01'
        }
      }),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, writeFile, mkdtemp, rename, rm } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);

    await exportCommand({});

    expect(mockClient.listPrompts).toHaveBeenCalled();
    expect(mockClient.exportPrompt).toHaveBeenCalledWith('test-prompt', true);
    expect(mkdir).toHaveBeenCalledWith('/resolved/./test/prompts', { recursive: true });
    expect(mkdtemp).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(2); // 1 prompt file + 1 index file
    expect(rename).toHaveBeenCalledTimes(2); // 1 prompt file + 1 index file
  });

  it('should use CLI options when config not found', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(null);

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      listPrompts: vi.fn().mockResolvedValue({
        data: [],
        page: 1,
        per_page: 50,
        has_more: false,
      }),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    await exportCommand({
      tenantId: 'cli-tenant',
      serviceKey: 'sk-cli',
      apiUrl: 'https://cli.test.com',
    });

    expect(createApiClient).toHaveBeenCalledWith({
      apiUrl: 'https://cli.test.com',
      serviceKey: 'sk-cli',
      tenantId: 'cli-tenant',
    });
  });

  it('should error when no config and missing options', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(null);

    const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

    await exportCommand({});

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No config file found')
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should sanitize prompt names for filenames', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    const mockPrompt = {
      promptName: 'Test Prompt!@#',
      category: 'test',
      description: '',
      enabled: true,
      systemMessage: 'System',
      userMessage: 'User',
      variables: [],
      toolDefs: [],
      scenarios: [],
      models: [],
      modelSampling: false,
      metadata: {},
      etag: 'test',
      publishedEtag: null,
      publishedVersion: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      listPrompts: vi.fn().mockResolvedValue({
        data: [
          {
            promptName: 'Test Prompt!@#',
            category: 'test',
            description: '',
            enabled: true,
            updatedAt: '2024-01-01',
          },
        ],
        page: 1,
        per_page: 50,
        has_more: false,
      }),
      exportPrompt: vi.fn().mockResolvedValue({
        data: {
          manifest: mockPrompt,
          exportedAt: '2024-01-01'
        }
      }),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, writeFile, mkdtemp, rename, rm } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);

    await exportCommand({});

    // Should sanitize special characters to underscores
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('test_prompt___'),
      expect.any(String),
      'utf-8'
    );
  });

  it('should generate warning headers in exported files', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

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
      models: [],
      modelSampling: false,
      metadata: {},
      etag: 'test',
      publishedEtag: null,
      publishedVersion: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      listPrompts: vi.fn().mockResolvedValue({
        data: [
          {
            promptName: 'test-prompt',
            category: 'test',
            description: 'Test',
            enabled: true,
            updatedAt: '2024-01-01',
          },
        ],
        page: 1,
        per_page: 50,
        has_more: false,
      }),
      exportPrompt: vi.fn().mockResolvedValue({
        data: {
          manifest: mockPrompt,
          exportedAt: '2024-01-01'
        }
      }),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, writeFile, mkdtemp, rename, rm } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);

    await exportCommand({});

    const writeFileCall = vi.mocked(writeFile).mock.calls[0];
    const fileContent = writeFileCall[1] as string;

    expect(fileContent).toContain('WARNING: This file is auto-generated');
    expect(fileContent).toContain('DO NOT EDIT MANUALLY');
    expect(fileContent).toContain('skej export');
  });

  it('should generate index.ts with all exports', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    const mockPromptOne = {
      promptName: 'prompt-one',
      category: 'test',
      description: '',
      enabled: true,
      systemMessage: 'System',
      userMessage: 'User',
      variables: [],
      toolDefs: [],
      scenarios: [],
      models: [],
      metadata: {},
      etag: 'test',
      publishedEtag: null,
      publishedVersion: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const mockPromptTwo = {
      promptName: 'prompt-two',
      category: 'test',
      description: '',
      enabled: true,
      systemMessage: 'System',
      userMessage: 'User',
      variables: [],
      toolDefs: [],
      scenarios: [],
      models: [],
      modelSampling: false,
      metadata: {},
      etag: 'test',
      publishedEtag: null,
      publishedVersion: null,
      createdAt: '2024-01-01',
      updatedAt: '2024-01-01',
    };

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      listPrompts: vi.fn().mockResolvedValue({
        data: [
          {
            promptName: 'prompt-one',
            category: 'test',
            description: '',
            enabled: true,
            updatedAt: '2024-01-01',
          },
          {
            promptName: 'prompt-two',
            category: 'test',
            description: '',
            enabled: true,
            updatedAt: '2024-01-01',
          },
        ],
        page: 1,
        per_page: 50,
        has_more: false,
      }),
      exportPrompt: vi.fn()
        .mockResolvedValueOnce({
          data: {
            manifest: mockPromptOne,
            exportedAt: '2024-01-01'
          }
        })
        .mockResolvedValueOnce({
          data: {
            manifest: mockPromptTwo,
            exportedAt: '2024-01-01'
          }
        }),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, writeFile, mkdtemp, rename, rm } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(rm).mockResolvedValue(undefined);

    await exportCommand({});

    // Find the index.ts write call
    const indexWriteCall = vi.mocked(writeFile).mock.calls.find((call) =>
      call[0].toString().endsWith('index.ts')
    );

    expect(indexWriteCall).toBeDefined();
    const indexContent = indexWriteCall![1] as string;

    expect(indexContent).toContain('export { default as promptOne }');
    expect(indexContent).toContain('export { default as promptTwo }');
  });
});
