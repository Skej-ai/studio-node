/**
 * Variable definition in manifest
 */
export interface VariableDefinition {
  name: string;
  type: string;
  required: boolean;
  default?: any;
}

/**
 * Tool function definition (OpenAI format)
 */
export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Tool definition
 */
export interface ToolDefinition {
  type: 'function';
  function: ToolFunction;
}

/**
 * Model configuration
 * Only provider, name, and modelDefKey are meta fields
 * All other fields are provider-specific and passed through
 */
export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'bedrock' | 'deepseek';
  name: string;
  modelDefKey?: string;
  [key: string]: any; // Provider-specific parameters
}

/**
 * Scenario definition
 */
export interface Scenario {
  name: string;
  description: string;
  instructions: string;
}

/**
 * Agent/Prompt manifest
 */
export interface Manifest {
  systemMessage: string;
  userMessage: string;
  variables: VariableDefinition[];
  toolDefs: ToolDefinition[];
  models: ModelConfig[];
  modelSampling?: boolean;
  scenarios?: Scenario[];
}

/**
 * Message in conversation
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  id: string;
  type?: string;
  name: string;
  args: Record<string, any>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  tool_call_id: string;
  content: any;
}

/**
 * Provider credentials
 */
export interface ProviderCredentials {
  anthropic?: {
    apiKey: string;
  };
  openai?: {
    apiKey: string;
  };
  bedrock?: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  deepseek?: {
    apiKey: string;
  };
}

/**
 * Tool handler with execute method
 */
export interface ToolHandler {
  execute: (args: any) => Promise<any>;
}

/**
 * Tool router - maps tool names to handlers with execute method
 * Excludes built-in tools: finish_agent_run, fetch_available_scenarios, fetch_scenario_specific_instructions
 */
export type ToolRouter = Record<string, ToolHandler>;

/**
 * Tool call callback
 */
export interface ToolCallCallback {
  (params: { toolCall: ToolCall; toolResponse: any }): Promise<{ abort?: boolean } | void>;
}

/**
 * Usage tracking with cost
 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalCostUSD: number;
}

/**
 * LLM invocation result
 */
export interface InvokeResult {
  message: Message;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Execution result
 */
export interface ExecutionResult {
  ok: boolean;
  usage: Usage;
  result: any;
  messages: Message[];
  error?: string;
}

/**
 * Tracing configuration for observability
 */
export interface TracingConfig {
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
}

/**
 * Base executor configuration
 */
export interface BaseExecutorConfig {
  manifest: Manifest;
  variables?: Record<string, any>;
  toolRouter?: ToolRouter;
  credentials: ProviderCredentials;
  messages?: Message[];
  onToolCall?: ToolCallCallback;
  log?: (message: string, ...args: any[]) => void;
  executorFactory?: (config: BaseExecutorConfig) => Promise<any>;
  imageCache?: any;
  tracing?: TracingConfig;
}

/**
 * Invoke options for LLM calls
 */
export interface InvokeOptions {
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'required' | 'none';
}
