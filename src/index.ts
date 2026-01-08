/**
 * @skej/studio - Manifest-based LLM executor with Studio integration
 *
 * Multi-provider LLM executor with automatic prompt loading from Studio API or local files.
 * Supports: Anthropic, OpenAI, Bedrock, DeepSeek
 */

// Main executor class (recommended)
export { StudioExecutor, type StudioExecutorConfig, type ExecuteOptions } from './StudioExecutor.js';

// Lower-level APIs
export { createExecutor } from './executorFactory.js';
export { default as BaseExecutor } from './BaseExecutor.js';
export { default as ImageCache } from './ImageCache.js';

// Provider adapters
export { default as AnthropicExecutor } from './providers/anthropic.js';
export { default as OpenAIExecutor } from './providers/openai.js';
export { default as BedrockExecutor } from './providers/bedrock.js';
export { default as DeepSeekExecutor } from './providers/deepseek.js';

// Runtime API (for apiMode support)
export {
  initRuntime,
  getRuntime,
  loadPrompt,
  isApiMode,
  clearRuntime,
  type RuntimeContext,
  type StudioConfig,
  type Prompt,
} from './runtime.js';

// Studio API Client
export {
  StudioApiClient,
  createApiClient,
  type ApiOptions,
  type PromptListItem,
  type ListPromptsResponse,
  type ExportResponse,
  type Block,
  type BlocksResponse,
  type CreateBlockRequest,
  type UpdateBlockRequest,
  type SystemModel,
  type SystemModelsResponse,
  type TenantModel,
  type TenantModelsResponse,
  type Trace,
  type TracesResponse,
  type CreatePromptRequest,
  type UpdatePromptRequest,
} from './cli/utils/api.js';

// Export types
export type {
  Manifest,
  ModelConfig,
  ToolDefinition,
  ToolFunction,
  Scenario,
  Message,
  ToolCall,
  ToolResult,
  ProviderCredentials,
  ToolRouter,
  ToolCallCallback,
  Usage,
  InvokeResult,
  ExecutionResult,
  BaseExecutorConfig,
  InvokeOptions,
  VariableDefinition
} from './types.js';
