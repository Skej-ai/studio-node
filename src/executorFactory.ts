/**
 * Executor Factory
 *
 * Creates provider-specific executor instances based on manifest configuration.
 * Supports: anthropic, openai, bedrock, deepseek
 */

import AnthropicExecutor from './providers/anthropic.js';
import OpenAIExecutor from './providers/openai.js';
import BedrockExecutor from './providers/bedrock.js';
import DeepSeekExecutor from './providers/deepseek.js';
import type { BaseExecutorConfig } from './types.js';
import type BaseExecutor from './BaseExecutor.js';

/**
 * Create executor for the given manifest and configuration
 */
export async function createExecutor(config: BaseExecutorConfig): Promise<BaseExecutor> {
  const { manifest, log = console.log } = config;

  // Validate manifest
  if (!manifest) {
    throw new Error('[executorFactory] manifest is required');
  }

  if (!manifest.models || manifest.models.length === 0) {
    throw new Error('[executorFactory] manifest.models is required');
  }

  // Get primary model configuration
  const primaryModel = manifest.models[0];
  const provider = primaryModel.provider;

  if (!provider) {
    throw new Error('[executorFactory] modelConfig.models[0].provider is required');
  }

  // Pass factory to executor for dynamic model switching
  const configWithFactory: BaseExecutorConfig = {
    ...config,
    executorFactory: createExecutor
  };

  // Create provider-specific executor
  // Credential validation happens in each executor's constructor
  switch (provider.toLowerCase()) {
    case 'anthropic':
      log(`[executorFactory] Creating Anthropic executor: ${primaryModel.name}`);
      return new AnthropicExecutor(configWithFactory);

    case 'openai':
      log(`[executorFactory] Creating OpenAI executor: ${primaryModel.name}`);
      return new OpenAIExecutor(configWithFactory);

    case 'bedrock':
      log(`[executorFactory] Creating Bedrock executor: ${primaryModel.name}`);
      return new BedrockExecutor(configWithFactory);

    case 'deepseek':
      log(`[executorFactory] Creating DeepSeek executor: ${primaryModel.name}`);
      return new DeepSeekExecutor(configWithFactory);

    default:
      throw new Error(`[executorFactory] Unsupported provider: ${provider}`);
  }
}
