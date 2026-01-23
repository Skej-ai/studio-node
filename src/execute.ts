/**
 * Execute Helper
 *
 * Convenience function for executing prompts with automatic API loading
 * Supports both local manifest and API mode
 */

import { createExecutor } from './executorFactory.js';
import { initRuntime, loadPrompt, getRuntime } from './runtime.js';
import type { Manifest, ProviderCredentials, InvokeOptions, ExecutionResult } from './types.js';

/**
 * Execute a prompt with automatic loading based on apiMode
 *
 * Usage:
 *
 * // With local manifest (apiMode: false)
 * const result = await executePrompt(myPrompt, { message: 'Hello' }, credentials);
 *
 * // With API mode (apiMode: true)
 * const result = await executePrompt('my-prompt', { message: 'Hello' }, credentials);
 *
 * @param promptOrName - Prompt manifest object OR prompt name string (when apiMode is true)
 * @param variables - Variable values to pass to the prompt
 * @param credentials - Provider credentials
 * @param options - Additional execution options
 */
export async function executePrompt(
  promptOrName: Manifest | string,
  variables: Record<string, any>,
  credentials: ProviderCredentials,
  options?: InvokeOptions
): Promise<ExecutionResult> {
  let manifest: Manifest;
  let maxMessages: number | undefined;
  let studioApiClient: any = undefined;

  // Always try to get maxMessages and apiClient from config if available
  try {
    await initRuntime();
    const { config, client } = getRuntime();
    maxMessages = config.maxMessages;
    studioApiClient = client; // Pass API client for model pricing
  } catch {
    // Runtime not initialized, will use default (50) in BaseExecutor
    maxMessages = undefined;
  }

  // If string provided, load from API
  if (typeof promptOrName === 'string') {
    const { config } = getRuntime();

    if (!config.apiMode) {
      throw new Error(
        `Cannot load prompt '${promptOrName}' by name when apiMode is false. ` +
        'Either set apiMode: true in studio.config.js or pass the prompt manifest directly.'
      );
    }

    // Load from API
    manifest = await loadPrompt(promptOrName);
  } else {
    // Use provided manifest
    manifest = promptOrName;
  }

  // Create executor and execute
  const executor = await createExecutor({
    manifest,
    credentials,
    variables,
    maxMessages,
    studioApiClient, // Pass API client for model pricing
    ...options,
  });

  return executor.execute();
}

/**
 * Execute a prompt in API mode (always loads from API)
 *
 * @param promptName - Name of the prompt to load from API
 * @param variables - Variable values to pass to the prompt
 * @param credentials - Provider credentials
 * @param options - Additional execution options
 */
export async function executePromptFromApi(
  promptName: string,
  variables: Record<string, any>,
  credentials: ProviderCredentials,
  options?: InvokeOptions
): Promise<ExecutionResult> {
  // Initialize runtime
  await initRuntime();

  const { config, client } = getRuntime();

  // Load from API
  const manifest = await loadPrompt(promptName);

  // Create executor and execute
  const executor = await createExecutor({
    manifest,
    credentials,
    variables,
    maxMessages: config.maxMessages, // Always use from config, defaults to 50 in BaseExecutor
    studioApiClient: client, // Pass API client for model pricing
    ...options,
  });

  return executor.execute();
}
