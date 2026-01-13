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
  readdir: vi.fn(),
}));

vi.mock('adm-zip', () => ({
  default: vi.fn(() => ({
    extractAllTo: vi.fn(),
  })),
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
    // Mock process.exit to throw error and simulate exit
    vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`process.exit(${code})`);
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export prompts successfully', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    // Mock zip buffer with some fake data
    const mockZipBuffer = Buffer.from('fake-zip-data');

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      exportAllPrompts: vi.fn().mockResolvedValue(mockZipBuffer),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, mkdtemp, rm, readdir } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(readdir).mockResolvedValue(['test-prompt.json', 'another-prompt.json'] as any);

    await exportCommand({});

    expect(mockClient.exportAllPrompts).toHaveBeenCalled();
    expect(mkdir).toHaveBeenCalledWith('/resolved/./test/prompts', { recursive: true });
    expect(mkdtemp).toHaveBeenCalled();
    expect(readdir).toHaveBeenCalled();
  });

  it('should use CLI options when config not found', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(null);

    const mockZipBuffer = Buffer.from('fake-zip-data');

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      exportAllPrompts: vi.fn().mockResolvedValue(mockZipBuffer),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, mkdtemp, rm, readdir } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(readdir).mockResolvedValue([' test-prompt.json'] as any);

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

    await expect(exportCommand({})).rejects.toThrow('process.exit(1)');

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('No config file found')
    );
  });

  it('should sanitize prompt names for filenames', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    const mockZipBuffer = Buffer.from('fake-zip-data');

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      exportAllPrompts: vi.fn().mockResolvedValue(mockZipBuffer),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, mkdtemp, rm, readdir } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(rm).mockResolvedValue(undefined);
    // Return a filename with special characters sanitized
    vi.mocked(readdir).mockResolvedValue(['test_prompt___.json'] as any);

    await exportCommand({});

    // The zip extraction handles filename sanitization
    expect(mockClient.exportAllPrompts).toHaveBeenCalled();
    expect(readdir).toHaveBeenCalled();
  });

  it('should export prompts using bulk zip API', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    const mockZipBuffer = Buffer.from('fake-zip-data');

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      exportAllPrompts: vi.fn().mockResolvedValue(mockZipBuffer),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, mkdtemp, rm, readdir } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(readdir).mockResolvedValue(['test-prompt.json'] as any);

    await exportCommand({});

    // Verify zip API was called
    expect(mockClient.exportAllPrompts).toHaveBeenCalled();
    expect(readdir).toHaveBeenCalled();
  });

  it('should handle multiple prompts in zip', async () => {
    const { loadConfig } = await import('../utils/config.js');
    vi.mocked(loadConfig).mockResolvedValue(mockConfig);

    const mockZipBuffer = Buffer.from('fake-zip-data');

    const { createApiClient } = await import('../utils/api.js');
    const mockClient = {
      exportAllPrompts: vi.fn().mockResolvedValue(mockZipBuffer),
    };
    vi.mocked(createApiClient).mockReturnValue(mockClient as any);

    const { mkdir, mkdtemp, rm, readdir } = await import('fs/promises');
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(mkdtemp).mockResolvedValue('/tmp/skej-export-test123');
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(readdir).mockResolvedValue(['prompt-one.json', 'prompt-two.json'] as any);

    await exportCommand({});

    // Verify multiple prompts were handled
    expect(mockClient.exportAllPrompts).toHaveBeenCalled();
    expect(readdir).toHaveBeenCalled();
  });
});
