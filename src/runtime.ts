/**
 * Runtime API
 *
 * Utilities for loading prompts at runtime from Studio API
 * Used when apiMode is enabled in studio.config
 */

import { loadConfig, type StudioConfig } from './cli/utils/config.js';
import { createApiClient, StudioApiClient, type Prompt } from './cli/utils/api.js';

/**
 * Runtime context with config and API client
 */
export interface RuntimeContext {
  config: StudioConfig;
  client: StudioApiClient;
}

let cachedContext: RuntimeContext | null = null;

/**
 * Initialize runtime context from config
 * Loads studio.config.js/ts and creates API client
 */
export async function initRuntime(cwd?: string): Promise<RuntimeContext> {
  if (cachedContext) {
    return cachedContext;
  }

  const config = await loadConfig(cwd);

  if (!config) {
    throw new Error(
      'No studio.config.js or studio.config.ts found. Run: skej init'
    );
  }

  const client = createApiClient({
    apiUrl: config.apiUrl,
    serviceKey: config.serviceKey,
    tenantId: config.tenantId,
  });

  cachedContext = { config, client };

  return cachedContext;
}

/**
 * Get runtime context (must call initRuntime first)
 */
export function getRuntime(): RuntimeContext {
  if (!cachedContext) {
    throw new Error('Runtime not initialized. Call initRuntime() first.');
  }

  return cachedContext;
}

/**
 * Load prompt from API by name
 * Uses export endpoint with createVersion=false to get the same manifest schema as files
 * Returns prompt manifest ready for execution
 */
export async function loadPrompt(promptName: string): Promise<any> {
  const { client } = getRuntime();

  // Use export API with createVersion=false to avoid creating version snapshots
  const exportResponse = await client.exportPrompt(promptName, false);
  const manifest = exportResponse.data.manifest;

  // Return manifest in same format as exported files
  return {
    promptName: manifest.promptName,
    category: manifest.category,
    description: manifest.description,
    enabled: manifest.enabled,
    systemMessage: manifest.systemMessage,
    userMessage: manifest.userMessage,
    variables: manifest.variables,
    toolDefs: manifest.toolDefs,
    scenarios: manifest.scenarios || [],
    models: manifest.models,
    modelSampling: manifest.modelSampling,
    metadata: manifest.metadata,
  };
}

/**
 * Check if API mode is enabled
 */
export async function isApiMode(): Promise<boolean> {
  try {
    const { config } = await initRuntime();
    return config.apiMode;
  } catch {
    return false;
  }
}

/**
 * Clear cached runtime context
 */
export function clearRuntime(): void {
  cachedContext = null;
}

// Re-export types for convenience
export type { StudioConfig, Prompt };
