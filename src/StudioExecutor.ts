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
import { join, resolve } from 'path';
import { readdir } from 'fs/promises';

export interface StudioExecutorConfig {
  credentials: ProviderCredentials;
  tenantId?: string; // Optional override of config tenantId
  config?: StudioConfig; // Optional: provide config directly (for testing)
}

export interface ExecuteOptions extends InvokeOptions {
  apiMode?: boolean; // Override config apiMode for this execution
  tracing?: {
    enabled: boolean;
    apiUrl?: string;
    tenantId?: string;
    serviceKey?: string;
    promptName?: string;
    executionId?: string;
    filters?: {
      teamId?: string;
      userId?: string;
      resourceId?: string;
      tags?: string[];
    };
  };
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

    // Load prompt manifest
    const manifest = useApi
      ? await this.loadPromptFromApi(promptName)
      : await this.loadPromptFromFile(promptName);

    // Create provider-specific executor
    const executor = await createExecutor({
      manifest,
      credentials: this.credentials,
      variables,
      toolRouter,
      ...options,
    });

    // Execute
    return executor.execute();
  }

  /**
   * Load prompt from API
   * Uses export endpoint with createVersion=false to get the same manifest schema as files
   */
  private async loadPromptFromApi(promptName: string): Promise<Manifest> {
    // Use export API with createVersion=false to avoid creating version snapshots
    const exportResponse = await this.client.exportPrompt(promptName, false);
    const manifest = exportResponse.data.manifest;

    // Return manifest in same format as exported files
    return {
      systemMessage: manifest.systemMessage,
      userMessage: manifest.userMessage,
      variables: manifest.variables,
      toolDefs: manifest.toolDefs,
      scenarios: manifest.scenarios || [],
      models: manifest.models,
      modelSampling: manifest.modelSampling,
    };
  }

  /**
   * Load prompt from local filesystem
   */
  private async loadPromptFromFile(promptName: string): Promise<Manifest> {
    // Sanitize filename (same logic as export command)
    const filename = promptName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    // Resolve path from config outputDir
    const outputDir = resolve(this.config.outputDir);
    const filePath = join(outputDir, `${filename}.ts`);

    try {
      // For TypeScript/ESM, we need to use dynamic import
      const fileUrl = new URL(`file://${filePath}`);
      const module = await import(fileUrl.href);

      const manifest = module.default || module[Object.keys(module)[0]];

      if (!manifest) {
        throw new Error(`No default export found in ${filePath}`);
      }

      return manifest;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' ||
          (error as NodeJS.ErrnoException).code === 'ENOENT') {
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
    const outputDir = resolve(this.config.outputDir);

    try {
      const files = await readdir(outputDir);
      const prompts = [];

      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;

        try {
          const filePath = join(outputDir, file);
          const fileUrl = new URL(`file://${filePath}`);
          const module = await import(fileUrl.href);
          const manifest = module.default || module[Object.keys(module)[0]];

          if (!manifest) continue;

          // Extract prompt name from filename
          const promptName = file.replace(/\.(ts|js)$/, '');

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
