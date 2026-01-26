/**
 * BaseExecutor - Stateless LLM orchestration
 *
 * Adapted from Skej's executor with all dependencies removed:
 * - No LangChain (uses native SDKs)
 * - No MongoDB/DynamoDB (stateless)
 * - No trace creation (returns execution data)
 * - No credit tracking (caller's responsibility)
 *
 * Core responsibilities:
 * - Variable validation and template population
 * - Message building from manifest
 * - Tool call loop orchestration
 * - Dynamic model switching (future)
 */

import type {
  BaseExecutorConfig,
  Manifest,
  Message,
  ToolCall,
  ToolResult,
  ToolDefinition,
  Scenario,
  InvokeOptions,
  InvokeResult,
  ExecutionResult,
  Usage,
  ModelConfig,
  ToolRouter,
  ToolCallCallback,
  TracingConfig,
  ModelPricing
} from './types.js';
import { sendTrace } from './tracing.js';

export default class BaseExecutor {
  protected manifest: Manifest;
  protected variables: Record<string, any>;
  protected toolRouter: ToolRouter;
  protected credentials: any;
  protected log: (message: string, ...args: any[]) => void;
  protected messages: Message[];
  protected onToolCall?: ToolCallCallback;
  protected cancelled: boolean;
  protected toolErrorCount: Record<string, number>;
  protected forceNextTool?: string;
  protected executorFactory?: (config: BaseExecutorConfig) => Promise<any>;
  protected instructions: string;
  protected modelConfig: any;
  protected primaryModelConfig: ModelConfig;
  protected provider: string;
  protected model: string;
  protected scenarios: Scenario[];
  protected allToolDefs: ToolDefinition[];
  protected tracing?: TracingConfig;
  protected files?: Array<any>;
  protected maxMessages: number;
  protected studioApiClient?: any;
  protected modelPricing?: ModelPricing;
  protected pricingFetchPromise?: Promise<void>;
  protected initialToolChoice: 'auto' | 'required' | 'none' | string;

  constructor({
    // Core execution
    manifest,          // Agent manifest with systemMessage, userMessage, toolDefs, variables, models
    variables = {},    // Runtime variables for template population
    toolRouter,        // Tool implementations: { toolName: { execute: async (args) => result } }
    credentials,       // Provider credentials: { anthropic: { apiKey }, ... }

    // Optional
    messages = [],     // Pre-built messages for continuation
    onToolCall,        // Callback after each tool call: async ({ toolCall, toolResponse }) => { abort: boolean }
    log = console.log, // Logger function
    tracing,           // Tracing configuration for observability
    files,             // Files (images, audio) for vision/audio prompts
    maxMessages = 50,  // Maximum messages before throwing error
    studioApiClient,   // Optional Studio API client for fetching model pricing
    initialToolChoice = 'required', // Initial tool choice for first turn

    // Internal (passed by factory for model switching)
    executorFactory
  }: BaseExecutorConfig) {
    // Manifest
    this.manifest = manifest;
    if (!this.manifest) {
      throw new Error('[BaseExecutor] manifest is required');
    }

    // Validate required manifest fields
    this.validateManifest();

    // Variables
    this.variables = variables;
    this.toolRouter = toolRouter || {};
    this.credentials = credentials || {};
    this.log = log;
    this.files = files;
    this.maxMessages = maxMessages;
    this.studioApiClient = studioApiClient;
    this.initialToolChoice = initialToolChoice;

    // Messages
    this.messages = messages;

    // Callbacks
    this.onToolCall = onToolCall;

    // State
    this.cancelled = false;
    this.toolErrorCount = {};
    this.forceNextTool = undefined;

    // Tracing
    this.tracing = tracing;

    // Executor factory for model switching
    this.executorFactory = executorFactory;

    // Build system instructions from manifest
    this.instructions = this.buildInstructions();

    // Extract models
    this.modelConfig = manifest.models;

    // Primary model - store entire config for provider-specific params
    this.primaryModelConfig = this.modelConfig[0];
    this.provider = this.primaryModelConfig.provider;
    this.model = this.primaryModelConfig.name;

    // All other params (temperature, top_p, reasoning, etc.) are provider-specific
    // and extracted by each provider adapter

    // Scenarios (no auto-injection - manifest should have all tools)
    this.scenarios = manifest.scenarios || [];

    // Use tools from manifest - process to move reasoning fields to top
    this.allToolDefs = this.processToolDefinitions(manifest.tools);

    // Load model pricing (from cache or API) in background (non-blocking)
    if (this.studioApiClient) {
      this.pricingFetchPromise = this.loadModelPricing();
    }
  }

  /**
   * Validate required manifest fields
   */
  protected validateManifest(): void {
    // Check for deprecated pre-rendered format
    if ((this.manifest as any).systemMessage !== undefined ||
        (this.manifest as any).userMessage !== undefined ||
        (this.manifest as any).toolDefs !== undefined) {
      throw new Error(
        '[BaseExecutor] Manifest uses deprecated pre-rendered format. ' +
        'Please re-export prompts with: skej export'
      );
    }

    const required = ['system', 'user', 'blocks', 'variables', 'tools', 'models'];

    for (const field of required) {
      if (this.manifest[field as keyof Manifest] === undefined) {
        throw new Error(`[BaseExecutor] manifest.${field} is required`);
      }
    }

    if (!this.manifest.models || this.manifest.models.length === 0) {
      throw new Error('[BaseExecutor] manifest.models is required');
    }

    // Validate arrays
    if (!Array.isArray(this.manifest.system)) {
      throw new Error('[BaseExecutor] manifest.system must be an array');
    }
    if (!Array.isArray(this.manifest.user)) {
      throw new Error('[BaseExecutor] manifest.user must be an array');
    }
    if (!Array.isArray(this.manifest.blocks)) {
      throw new Error('[BaseExecutor] manifest.blocks must be an array');
    }
  }

  /**
   * Build system instructions from manifest
   * Renders system chunks with block references and variables resolved
   */
  protected buildInstructions(): string {
    return this.renderChunks(this.manifest.system, this.variables);
  }

  /**
   * Render chunks into a single message, resolving block references and variables
   * Replaces {component.blockName} with block content from manifest.blocks
   * Supports nested blocks (blocks can reference other blocks)
   * Replaces {variableName} with variable values
   */
  protected renderChunks(chunks: any[], variables: Record<string, any> = {}): string {
    if (!chunks || chunks.length === 0) {
      return '';
    }

    const renderedChunks = chunks.map(chunk => {
      let content = chunk.content;

      // First, resolve block references recursively: {component.blockName}
      content = this.resolveBlockReferences(content, new Set());

      // Then, populate variables: {variableName}
      content = this.populateTemplate(content, variables);

      return content;
    });

    // Join all chunks with double newlines
    return renderedChunks.join('\n\n');
  }

  /**
   * Recursively resolve block references with circular dependency protection
   * @param content - Content to resolve
   * @param visitedBlocks - Set of block names currently being resolved (for cycle detection)
   * @param depth - Current recursion depth (for max depth protection)
   */
  protected resolveBlockReferences(content: string, visitedBlocks: Set<string>, depth: number = 0): string {
    const MAX_DEPTH = 50; // Maximum nesting depth to prevent infinite loops

    // Safety check: prevent excessive recursion depth
    if (depth > MAX_DEPTH) {
      this.log(`[BaseExecutor] Max block nesting depth (${MAX_DEPTH}) exceeded. Stopping resolution.`);
      return content; // Return content as-is
    }

    return content.replace(/\{component\.([^}]+)\}/g, (match: string, blockName: string) => {
      // Check for circular reference
      if (visitedBlocks.has(blockName)) {
        this.log(`[BaseExecutor] Circular block reference detected: ${blockName} at depth ${depth}`);
        return match; // Leave as-is to avoid infinite loop
      }

      // Find the block
      const block = this.manifest.blocks?.find(b => b.name === blockName);
      if (!block) {
        return match; // Block not found, leave as-is
      }

      // Mark this block as being visited
      const newVisitedBlocks = new Set(visitedBlocks);
      newVisitedBlocks.add(blockName);

      // Recursively resolve any nested block references in this block's content with incremented depth
      return this.resolveBlockReferences(block.content, newVisitedBlocks, depth + 1);
    });
  }

  /**
   * Populate template with variables
   * Replaces {variable} placeholders
   */
  protected populateTemplate(template: string, variables: Record<string, any>): string {
    if (!template) return '';

    return template.replace(/\{([^}]+)\}/g, (match, key) => {
      return variables[key] !== undefined ? variables[key] : match;
    });
  }

  /**
   * Cancel execution
   */
  cancel(): boolean {
    this.cancelled = true;
    return true;
  }

  /**
   * Convert tool choice string to OpenAI format
   * - 'auto' | 'required' | 'none' -> pass through
   * - 'tool_name' -> { type: 'function', function: { name: 'tool_name' } }
   */
  protected normalizeToolChoice(toolChoice: 'auto' | 'required' | 'none' | string): any {
    // Standard options - pass through
    if (toolChoice === 'auto' || toolChoice === 'required' || toolChoice === 'none') {
      return toolChoice;
    }

    // Specific tool name - convert to OpenAI format
    return {
      type: 'function',
      function: { name: toolChoice }
    };
  }

  /**
   * Process all tool definitions to reorder reasoning fields
   * Called once when loading tools from manifest
   */
  protected processToolDefinitions(tools: any[]): any[] {
    if (!tools || !Array.isArray(tools)) {
      return tools;
    }

    return tools.map(tool => this.processToolDefinition(tool));
  }

  /**
   * Process a single tool definition to move reasoning fields to the top
   * Handles OpenAI format: { type: "function", function: { parameters: {...} } }
   */
  protected processToolDefinition(tool: any): any {
    if (!tool || typeof tool !== 'object') {
      return tool;
    }

    // Clone to avoid mutating the original
    const processed = JSON.parse(JSON.stringify(tool));

    // OpenAI format: tool.function.parameters
    if (processed.function?.parameters) {
      processed.function.parameters = this.processToolSchema(processed.function.parameters);
    }

    return processed;
  }

  /**
   * Process tool schema to move reasoning fields to the top
   * This ensures that with strict: true, the LLM generates reasoning first
   *
   * @param schema - The input schema object (e.g., parameters or input_schema)
   * @returns Processed schema with reasoning fields at the top
   */
  protected processToolSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    // Clone to avoid mutating the original
    const processed = { ...schema };

    // Check if properties exists and has reasoning fields
    if (processed.properties && typeof processed.properties === 'object') {
      const properties = processed.properties;
      const reasoningFields = ['reason', 'reasoning'];

      // Find which reasoning field exists (if any)
      const reasoningField = reasoningFields.find(field => field in properties);

      if (reasoningField) {
        // Reorder properties with reasoning first
        const { [reasoningField]: reasoningProp, ...rest } = properties;
        processed.properties = {
          [reasoningField]: reasoningProp,
          ...rest
        };

        // Also reorder required array if it exists
        if (Array.isArray(processed.required) && processed.required.includes(reasoningField)) {
          processed.required = [
            reasoningField,
            ...processed.required.filter((f: string) => f !== reasoningField)
          ];
        }
      }
    }

    return processed;
  }

  /**
   * Get cache file path for model pricing
   */
  protected getPricingCachePath(): string | null {
    // Only available in Node.js
    if (typeof process === 'undefined' || !process.env) {
      return null;
    }

    const tmpdir = process.env.TMPDIR || process.env.TEMP || '/tmp';
    const cacheKey = `skej-model-pricing-${this.provider}-${this.model.replace(/\//g, '-')}.json`;

    // Dynamically import path if available
    try {
      const path = require('path');
      return path.join(tmpdir, cacheKey);
    } catch {
      // Fallback if path module not available
      return `${tmpdir}/${cacheKey}`;
    }
  }

  /**
   * Load model pricing from cache or fetch from Studio API
   * Cache TTL: 24 hours
   */
  protected async loadModelPricing(): Promise<void> {
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

    try {
      const cachePath = this.getPricingCachePath();

      // Try to load from cache first
      if (cachePath) {
        try {
          const fs = await import('fs/promises');
          const cacheData = await fs.readFile(cachePath, 'utf-8');
          const cached = JSON.parse(cacheData);

          // Check if cache is still fresh
          if (cached.timestamp && cached.pricing && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
            this.modelPricing = cached.pricing;
            this.log(`[BaseExecutor] Loaded pricing from cache for ${this.provider}/${this.model}: $${cached.pricing.inputTokensPer1M}/1M input, $${cached.pricing.outputTokensPer1M}/1M output`);
            return;
          }
        } catch (cacheError) {
          // Cache miss or read error, continue to fetch
        }
      }

      // Cache miss or stale - fetch from API
      if (!this.studioApiClient) {
        return;
      }

      const response = await this.studioApiClient.listSystemModels();

      // Find the pricing for the current model
      // API returns modelId, but manifest uses name field
      const modelInfo = response.models.find(
        (m: any) => m.provider === this.provider && m.modelId === this.model
      );

      if (modelInfo && modelInfo.pricing) {
        this.modelPricing = {
          provider: modelInfo.provider,
          name: modelInfo.modelId,
          inputTokensPer1M: modelInfo.pricing.inputTokensPer1M,
          outputTokensPer1M: modelInfo.pricing.outputTokensPer1M,
          currency: modelInfo.pricing.currency
        };

        // Cache the pricing
        if (cachePath) {
          try {
            const fs = await import('fs/promises');
            const cacheData = JSON.stringify({
              timestamp: Date.now(),
              pricing: this.modelPricing
            });
            await fs.writeFile(cachePath, cacheData, 'utf-8');
          } catch (writeError) {
            // Ignore cache write errors
          }
        }

        this.log(`[BaseExecutor] Fetched and cached pricing for ${this.provider}/${modelInfo.modelId}: $${this.modelPricing.inputTokensPer1M}/1M input, $${this.modelPricing.outputTokensPer1M}/1M output`);
      } else {
        this.log(`[BaseExecutor] No pricing found for ${this.provider}/${this.model}, using default`);
      }
    } catch (error: any) {
      this.log(`[BaseExecutor] Failed to load model pricing: ${error.message}, using default`);
    }
  }

  /**
   * Calculate cost in USD based on tokens and model
   * Uses pricing from cache/API if available, otherwise falls back to default
   */
  protected calculateCost(inputTokens: number, outputTokens: number): number {
    // Use fetched/cached pricing if available
    if (this.modelPricing) {
      const inputCost = (inputTokens / 1_000_000) * this.modelPricing.inputTokensPer1M;
      const outputCost = (outputTokens / 1_000_000) * this.modelPricing.outputTokensPer1M;
      return inputCost + outputCost;
    }

    // Default rough pricing
    // Using Claude Sonnet pricing as default: $3/MTok input, $15/MTok output
    const inputCost = (inputTokens / 1_000_000) * 3;
    const outputCost = (outputTokens / 1_000_000) * 15;
    return inputCost + outputCost;
  }

  /**
   * Main execution entry point
   * Returns: { ok, usage: { inputTokens, outputTokens, totalCostUSD }, result, messages, error? }
   */
  async execute(): Promise<ExecutionResult> {
    try {
      // Validate variables
      this.validateVariables();

      // Wait for pricing fetch to complete (non-blocking in constructor, but wait here before calculating costs)
      if (this.pricingFetchPromise) {
        await this.pricingFetchPromise;
      }

      // Build initial messages if not provided
      if (this.messages.length === 0) {
        this.messages = this.buildInitialMessages();
      }

      // First LLM invocation
      const turnStart = Date.now();

      // Convert initialToolChoice to OpenAI format
      // Provider adapters will translate to their specific format
      const toolChoice = this.normalizeToolChoice(this.initialToolChoice);

      const result = await this.invoke(this.messages, {
        tools: this.allToolDefs,
        tool_choice: toolChoice
      });
      const turnDuration = Date.now() - turnStart;

      // Track usage
      const usage: Usage = {
        inputTokens: result.usage?.input_tokens || 0,
        outputTokens: result.usage?.output_tokens || 0,
        totalCostUSD: 0
      };
      usage.totalCostUSD = this.calculateCost(usage.inputTokens, usage.outputTokens);

      // Add assistant message to stack
      this.messages.push(result.message);

      // Send trace for this turn
      const turnCost = this.calculateCost(result.usage?.input_tokens || 0, result.usage?.output_tokens || 0);
      await this.sendTurnTrace(result.usage || { input_tokens: 0, output_tokens: 0 }, turnDuration, turnCost);

      // Check if we need to process tool calls
      const hasToolRouter = this.toolRouter && Object.keys(this.toolRouter).length > 0;

      // Check if any tool calls are built-in scenario tools (always execute these)
      const builtInScenarioTools = ['fetch_available_scenarios', 'fetch_scenario_specific_instructions'];
      const hasBuiltInScenarioTools = result.message.tool_calls?.some(tc => builtInScenarioTools.includes(tc.name)) || false;

      let output: any;

      if (hasToolRouter || hasBuiltInScenarioTools) {
        // Run tool loop if: toolRouter provided (enforces terminating tool) OR built-in scenario tools
        output = await this.runToolLoop(result.message, usage);
      } else if (result.message.tool_calls && result.message.tool_calls.length > 0) {
        // No toolRouter but has tool calls - extract args from first tool call (playground mode)
        output = result.message.tool_calls[0].args;
      } else {
        // No toolRouter and no tool calls - return raw content
        output = result.message.content;
      }

      return {
        ok: !this.cancelled,
        usage,
        result: output,
        messages: this.messages
      };
    } catch (error: any) {
      return {
        ok: false,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalCostUSD: 0
        },
        result: null,
        messages: this.messages,
        error: error.message
      };
    }
  }

  /**
   * Validate variables against manifest schema
   */
  protected validateVariables(): void {
    const schema = this.manifest.variables || [];
    const required = schema.filter(v => v.required);

    for (const varDef of required) {
      if (this.variables[varDef.name] === undefined) {
        throw new Error(`[BaseExecutor] Required variable missing: ${varDef.name}`);
      }
    }
  }

  /**
   * Build initial message stack
   */
  protected buildInitialMessages(): Message[] {
    const messages: Message[] = [];

    // System message - render from chunks
    messages.push({
      role: 'system',
      content: this.instructions
    });

    // User message - render from chunks
    const populatedContent = this.renderChunks(this.manifest.user, this.variables);

    // If files are provided, build multimodal content
    let userContent: string | any[];
    if (this.files && this.files.length > 0) {
      userContent = [
        { type: 'text', text: populatedContent },
        ...this.files
      ];
    } else {
      userContent = populatedContent;
    }

    messages.push({
      role: 'user',
      content: userContent
    });

    return messages;
  }

  /**
   * Tool loop - handle tool calls until completion
   */
  protected async runToolLoop(message: Message, usage: Usage): Promise<any> {
    const terminatingTools = ['finish_agent_run', 'output'];

    while (this.hasToolCalls(message)) {
      if (this.cancelled) break;

      // Safety check: prevent infinite loops
      if (this.messages.length >= this.maxMessages) {
        const error = `[BaseExecutor] Message stack exceeded ${this.maxMessages} messages. Possible infinite loop detected. Agent must call a terminating tool (finish_agent_run or output) to complete.`;
        this.log(error);
        throw new Error(error);
      }

      // Execute tool calls
      const toolResults = await this.handleToolCalls(message.tool_calls!);

      // Check if any tool result wants to force a specific tool on next turn
      this.forceNextTool = undefined;
      for (const result of toolResults) {
        if (result.forceNextTool) {
          this.log(`[BaseExecutor] Tool result requests forcing next tool: ${result.forceNextTool}`);
          this.forceNextTool = result.forceNextTool;
          break; // Only honor the first one
        }
      }

      // Add tool results to messages
      for (const result of toolResults) {
        this.messages.push({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: JSON.stringify(result.content)
        });
      }

      // Call onToolCall callback
      if (this.onToolCall) {
        for (let i = 0; i < message.tool_calls!.length; i++) {
          const toolCall = message.tool_calls![i];
          const toolResult = toolResults[i];

          // Skip terminating tools
          if (terminatingTools.includes(toolCall.name)) {
            continue;
          }

          const callbackResult = await this.onToolCall({
            toolCall,
            toolResponse: toolResult.content
          });

          if (callbackResult && callbackResult.abort === true) {
            this.log(`[BaseExecutor] onToolCall signaled abort`);
            this.cancelled = true;
            break;
          }
        }
      }

      if (this.cancelled) break;

      // Check if terminating tool was called
      const terminatingCall = message.tool_calls?.find(call => terminatingTools.includes(call.name));
      if (terminatingCall) {
        const terminatingResult = toolResults.find(r => r.tool_call_id === terminatingCall.id);

        // If tool returned completed: false or error, continue loop
        if (terminatingResult && (terminatingResult.content.completed === false || terminatingResult.content.error)) {
          this.log(`[BaseExecutor] Terminating tool rejected, continuing`);
        } else {
          // Tool accepted, return output
          return terminatingCall.args;
        }
      }

      // Next LLM invocation
      // Use 'required' tool_choice to ensure agent always calls a tool in the loop
      // Unless a tool result specified forceNextTool
      const turnStart = Date.now();
      let toolChoiceStr: string = 'required';

      if (this.forceNextTool) {
        toolChoiceStr = this.forceNextTool;
        this.log(`[BaseExecutor] Forcing tool choice: ${this.forceNextTool}`);
      }

      // Convert to OpenAI format - provider adapters will translate
      const toolChoice = this.normalizeToolChoice(toolChoiceStr);

      const result = await this.invoke(this.messages, {
        tools: this.allToolDefs,
        tool_choice: toolChoice
      });
      const turnDuration = Date.now() - turnStart;

      // Update usage
      usage.inputTokens += result.usage?.input_tokens || 0;
      usage.outputTokens += result.usage?.output_tokens || 0;
      usage.totalCostUSD = this.calculateCost(usage.inputTokens, usage.outputTokens);

      // Add message and continue
      message = result.message;
      this.messages.push(message);

      // Send trace for this turn
      const turnCost = this.calculateCost(result.usage?.input_tokens || 0, result.usage?.output_tokens || 0);
      await this.sendTurnTrace(result.usage || { input_tokens: 0, output_tokens: 0 }, turnDuration, turnCost);
    }

    if (this.cancelled) {
      return { ok: false, status: 'cancelled' };
    }

    // No terminating tool found
    throw new Error('[BaseExecutor] Agent ended without calling terminating tool');
  }

  /**
   * Handle tool calls - execute sequentially
   */
  protected async handleToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      this.log(`[BaseExecutor] Executing tool: ${toolCall.name}`);

      const toolStart = Date.now();
      let toolResult: any;
      let toolStatus: 'success' | 'error' = 'success';

      // Handle built-in tools internally
      if (toolCall.name === 'finish_agent_run') {
        // Check if toolRouter has a handler for finish_agent_run
        const toolHandler = this.toolRouter[toolCall.name];

        if (toolHandler) {
          // Use custom handler if provided
          try {
            toolResult = await toolHandler.execute(toolCall.args);
            toolStatus = toolResult.error ? 'error' : 'success';
          } catch (error: any) {
            toolResult = {
              completed: false,
              error: true,
              message: error.message || 'An error occurred while executing finish_agent_run'
            };
          }
        } else {
          // Built-in terminating tool - return args directly
          toolResult = toolCall.args;
        }
        // Note: No toolTrace sent for finish_agent_run - it's captured in the turnTrace
      } else if (toolCall.name === 'fetch_available_scenarios') {
        toolResult = this.handleFetchAvailableScenarios();
        const toolDuration = Date.now() - toolStart;
        toolStatus = toolResult.error ? 'error' : 'success';
        await this.sendToolTrace(toolCall.name, {}, toolResult, toolDuration, toolStatus);
      } else if (toolCall.name === 'fetch_scenario_specific_instructions') {
        toolResult = this.handleFetchScenarioInstructions(toolCall.args);
        const toolDuration = Date.now() - toolStart;
        toolStatus = toolResult.error ? 'error' : 'success';
        await this.sendToolTrace(toolCall.name, toolCall.args, toolResult, toolDuration, toolStatus);
      } else {
        // Check toolRouter for user-defined tools
        const toolHandler = this.toolRouter[toolCall.name];

        if (!toolHandler) {
          toolResult = {
            completed: false,
            error: true,
            message: `Tool '${toolCall.name}' not found`
          };
        } else {
          try {
            toolResult = await toolHandler.execute(toolCall.args);
            this.toolErrorCount[toolCall.name] = 0;
          } catch (error: any) {
            this.toolErrorCount[toolCall.name] = (this.toolErrorCount[toolCall.name] || 0) + 1;
            this.log(`[BaseExecutor] Tool error: ${toolCall.name}`, error.message);

            // Fail after 3 errors
            if (this.toolErrorCount[toolCall.name] >= 3) {
              throw error;
            }

            toolResult = {
              completed: false,
              error: true,
              message: 'An error occurred while executing this tool. Please try a different approach.'
            };
          }
        }
      }

      // Extract forceNextTool if present in the tool result
      const forceNextTool = toolResult?.forceNextTool;

      results.push({
        tool_call_id: toolCall.id,
        content: toolResult,
        forceNextTool: forceNextTool
      });
    }

    return results;
  }

  /**
   * Handle fetch_available_scenarios tool
   */
  protected handleFetchAvailableScenarios(): any {
    const scenarios = this.scenarios.map(s => ({
      name: s.name,
      description: s.description
    }));

    return {
      completed: true,
      scenarios
    };
  }

  /**
   * Handle fetch_scenario_specific_instructions tool
   */
  protected handleFetchScenarioInstructions(args: any): any {
    const { scenarioNames } = args;

    if (!scenarioNames || !Array.isArray(scenarioNames)) {
      return {
        completed: false,
        error: true,
        message: 'scenarioNames must be an array'
      };
    }

    const scenarios: any[] = [];
    const notFound: string[] = [];

    for (const name of scenarioNames) {
      const scenario = this.scenarios.find(s => s.name === name);
      if (scenario) {
        scenarios.push({
          name: scenario.name,
          instructions: scenario.instructions
        });
      } else {
        notFound.push(name);
      }
    }

    if (notFound.length > 0) {
      return {
        completed: false,
        error: true,
        message: `Scenarios not found: ${notFound.join(', ')}`
      };
    }

    return {
      completed: true,
      scenarios
    };
  }

  /**
   * Send trace for LLM turn to observability API
   * Sends entire message stack with token usage for this turn
   */
  protected async sendTurnTrace(turnUsage: { input_tokens: number; output_tokens: number }, turnDuration: number, cost?: number): Promise<void> {
    if (!this.tracing) return;

    // Get the last assistant message as output (entire message object)
    const lastAssistantMessage = [...this.messages].reverse().find(m => m.role === 'assistant');
    const output = lastAssistantMessage || null;

    // Exclude the last assistant message from messages array (it's in output)
    const lastAssistantIndex = this.messages.lastIndexOf(lastAssistantMessage!);
    const messagesWithoutOutput = lastAssistantIndex >= 0
      ? [...this.messages.slice(0, lastAssistantIndex), ...this.messages.slice(lastAssistantIndex + 1)]
      : this.messages;

    // Skip first 2 messages (system and initial user) since they're in the manifest
    // Only send the conversation that happened after: tool calls, tool results, subsequent LLM responses
    const conversationMessages = messagesWithoutOutput.slice(2);

    const payload = {
      promptName: this.tracing.promptName || 'unknown',
      manifest: this.manifest,
      etag: this.tracing.etag || null,
      variables: this.variables,
      messages: conversationMessages,
      output: output,
      inputTokens: turnUsage.input_tokens,
      outputTokens: turnUsage.output_tokens,
      totalTokens: turnUsage.input_tokens + turnUsage.output_tokens,
      cost: cost || 0,
      duration: turnDuration,
      model: {
        provider: this.provider,
        name: this.model,
        metadata: this.primaryModelConfig.metadata || {}
      },
      status: 'completed',
      metadata: {
        turnNumber: this.messages.filter(m => m.role === 'assistant').length
      },
      tags: this.tracing.tags || []
    };

    await sendTrace(this.tracing, payload, this.log);
  }

  /**
   * Send trace for tool execution to observability API
   */
  protected async sendToolTrace(toolName: string, toolInput: any, toolOutput: any, duration: number, status: 'success' | 'error'): Promise<void> {
    if (!this.tracing) return;

    const payload = {
      promptName: this.tracing.promptName || 'unknown',
      manifest: this.manifest,
      etag: this.tracing.etag || null,
      variables: this.variables,
      messages: [],
      output: {
        toolName,
        input: toolInput,
        output: toolOutput
      },
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cost: 0,
      duration: duration,
      model: {
        provider: this.provider,
        name: this.model,
        metadata: this.primaryModelConfig.metadata || {}
      },
      status: status === 'success' ? 'completed' : 'error',
      metadata: {
        toolName,
        toolExecution: true
      },
      tags: this.tracing.tags || []
    };

    await sendTrace(this.tracing, payload, this.log);
  }

  // ============================================
  // Abstract methods - implemented by providers
  // ============================================

  /**
   * Invoke LLM
   * Returns: { message: { role, content, tool_calls }, usage: { input_tokens, output_tokens } }
   */
  async invoke(_messages: Message[], _options: InvokeOptions): Promise<InvokeResult> {
    throw new Error('invoke() must be implemented by provider adapter');
  }

  /**
   * Check if message has tool calls
   */
  hasToolCalls(_message: Message): boolean {
    throw new Error('hasToolCalls() must be implemented by provider adapter');
  }
}
