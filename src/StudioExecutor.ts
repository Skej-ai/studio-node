/**
 * Studio Executor
 *
 * Main executor class that loads prompts from API or filesystem
 * and executes them with configured credentials
 */

import { loadConfig, type StudioConfig } from './cli/utils/config.js';
import { createApiClient, StudioApiClient } from './cli/utils/api.js';
import { createExecutor } from './executorFactory.js';
import type { ProviderCredentials, ExecutionResult, InvokeOptions, Manifest } from './types.js';

export interface StudioExecutorConfig {
  credentials: ProviderCredentials;
  tenantId?: string; // Optional override of config tenantId
  config?: StudioConfig; // Optional: provide config directly (for testing)
}

export interface ExecuteOptions extends InvokeOptions {
  apiMode?: boolean; // Override config apiMode for this execution
  tracing?: {
    enabled: boolean;
    tags?: string[];
  };
  files?: Array<{
    type: string;
    image_url?: { url: string };
    input_audio?: { data: string; format: string };
  }>;
}

/**
 * Studio Executor
 *
 * Initialize once with credentials, execute prompts by name
 */
export class StudioExecutor {
  private credentials: ProviderCredentials;
  private config: StudioConfig;
  private client: StudioApiClient;
  private tenantId: string;

  private constructor(
    credentials: ProviderCredentials,
    config: StudioConfig,
    tenantId?: string
  ) {
    this.credentials = credentials;
    this.config = config;
    this.tenantId = tenantId || config.tenantId;

    // Create API client
    this.client = createApiClient({
      apiUrl: config.apiUrl,
      serviceKey: config.serviceKey,
      tenantId: this.tenantId,
    });
  }

  /**
   * Initialize Studio Executor
   */
  static async create(options: StudioExecutorConfig): Promise<StudioExecutor> {
    // Load config if not provided
    let config = options.config;
    if (!config) {
      const loadedConfig = await loadConfig();
      if (!loadedConfig) {
        throw new Error(
          'No studio.config.js or studio.config.ts found. Run: skej init'
        );
      }
      config = loadedConfig;
    }

    return new StudioExecutor(
      options.credentials,
      config,
      options.tenantId
    );
  }

  /**
   * Execute a prompt by name
   *
   * Automatically loads from API or filesystem based on config/options
   *
   * @param promptName - Name of the prompt to execute
   * @param variables - Variables to pass to the prompt
   * @param toolRouter - Tool router with execute methods { toolName: { execute: (args) => Promise<any> } }
   * @param options - Execution options (can override apiMode)
   */
  async execute(
    promptName: string,
    variables: Record<string, any> = {},
    toolRouter: Record<string, { execute: (args: any) => Promise<any> }> = {},
    options?: ExecuteOptions
  ): Promise<ExecutionResult> {
    // Determine whether to use API or filesystem
    const useApi = options?.apiMode !== undefined
      ? options.apiMode
      : this.config.apiMode;

    // Load prompt manifest with etag
    const exportedPrompt = useApi
      ? await this.loadPromptFromApi(promptName)
      : await this.loadPromptFromFile(promptName);

    const manifest = exportedPrompt.manifest;
    const etag = exportedPrompt.etag;

    // Enrich tracing config with studio config, promptName, and etag
    // Callers only provide: enabled, tags
    // Infrastructure config is auto-populated from studio config and method params
    const enrichedOptions = {
      ...options,
      tracing: options?.tracing ? {
        enabled: options.tracing.enabled,
        apiUrl: this.config.apiUrl,
        tenantId: this.tenantId,
        serviceKey: this.config.serviceKey,
        promptName: promptName,
        etag: etag,
        tags: options.tracing.tags,
      } : undefined,
      files: options?.files, // Pass files through for vision/audio
    };

    // Create provider-specific executor
    const executor = await createExecutor({
      manifest,
      credentials: this.credentials,
      variables,
      toolRouter,
      ...enrichedOptions,
    });

    // Execute
    return executor.execute();
  }

  /**
   * Load prompt from API
   * Uses export endpoint with createVersion=false to get the same manifest schema as files
   * Returns { manifest, etag, exportedAt }
   */
  private async loadPromptFromApi(promptName: string): Promise<{ manifest: Manifest; etag: string; exportedAt: string }> {
    // Use export API with createVersion=false to avoid creating version snapshots
    const exportResponse = await this.client.exportPrompt(promptName, false);

    // API returns { manifest, etag, exportedAt }
    return exportResponse.data;
  }

  /**
   * Load prompt from local filesystem
   * Returns { manifest, etag, exportedAt }
   */
  private async loadPromptFromFile(promptName: string): Promise<{ manifest: Manifest; etag: string; exportedAt: string }> {
    // Check if we're in Node.js environment
    if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
      throw new Error(
        'Filesystem mode is only supported in Node.js environment. ' +
        'Use apiMode: true in your config to load prompts from the API in browser environments.'
      );
    }

    // Dynamically import path and fs modules (only available in Node.js)
    const { join, resolve } = await import('path');
    const { readFile } = await import('fs/promises');

    // Sanitize filename (same logic as export command)
    const filename = promptName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    // Resolve path from config outputDir
    const outputDir = resolve(this.config.outputDir);
    const filePath = join(outputDir, `${filename}.json`);

    try {
      // Read the JSON file
      const fileContent = await readFile(filePath, 'utf-8');
      const exportedPrompt = JSON.parse(fileContent);

      // File contains { manifest, etag, exportedAt }
      return exportedPrompt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(
          `Prompt file not found: ${filePath}\n` +
          `Run 'skej export' to download prompts from Studio.`
        );
      }
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): StudioConfig {
    return { ...this.config };
  }

  /**
   * Get current tenant ID
   */
  getTenantId(): string {
    return this.tenantId;
  }

  /**
   * List available prompts/agents
   * @param filters - Optional filters (multiStep for agents, enabled for active prompts)
   * @returns Array of available prompts
   */
  async listPrompts(filters?: { multiStep?: boolean; enabled?: boolean }): Promise<Array<{
    promptName: string;
    category: string;
    description: string;
    enabled: boolean;
    updatedAt: string;
  }>> {
    // API mode - fetch from Studio API
    if (this.config.apiMode) {
      return this.client.listAllPrompts(filters);
    }

    // Filesystem mode - read from local directory
    // Check if we're in Node.js environment
    if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
      throw new Error(
        'Filesystem mode is only supported in Node.js environment. ' +
        'Use apiMode: true in your config to load prompts from the API in browser environments.'
      );
    }

    // Dynamically import Node.js modules
    const { join, resolve } = await import('path');
    const { readdir, readFile } = await import('fs/promises');

    const outputDir = resolve(this.config.outputDir);

    try {
      const files = await readdir(outputDir);
      const prompts = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = join(outputDir, file);
          const fileContent = await readFile(filePath, 'utf-8');
          const exportedPrompt = JSON.parse(fileContent);
          const manifest = exportedPrompt.manifest;

          if (!manifest) continue;

          // Extract prompt name from filename
          const promptName = file.replace(/\.json$/, '');

          // Apply filters
          if (filters?.multiStep !== undefined) {
            // Check if prompt has multiple steps (has tools other than just finish_agent_run)
            const hasMultipleSteps = manifest.toolDefs?.some((t: any) =>
              (t.name || t.function?.name) !== 'finish_agent_run'
            );
            if (filters.multiStep !== hasMultipleSteps) continue;
          }

          prompts.push({
            promptName,
            category: manifest.metadata?.category || 'uncategorized',
            description: manifest.metadata?.description || '',
            enabled: manifest.metadata?.enabled !== false,
            updatedAt: manifest.metadata?.updatedAt || new Date().toISOString()
          });
        } catch (err) {
          // Skip files that can't be loaded
          continue;
        }
      }

      // Apply enabled filter
      if (filters?.enabled !== undefined) {
        return prompts.filter(p => p.enabled === filters.enabled);
      }

      return prompts;
    } catch (error) {
      throw new Error(`Failed to list prompts from filesystem: ${(error as Error).message}`);
    }
  }
}
