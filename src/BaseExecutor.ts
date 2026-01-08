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
  TracingConfig
} from './types.js';

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
  protected executorFactory?: (config: BaseExecutorConfig) => Promise<any>;
  protected instructions: string;
  protected modelConfig: any;
  protected primaryModelConfig: ModelConfig;
  protected provider: string;
  protected model: string;
  protected scenarios: Scenario[];
  protected allToolDefs: ToolDefinition[];
  protected tracing?: TracingConfig;

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

    // Messages
    this.messages = messages;

    // Callbacks
    this.onToolCall = onToolCall;

    // State
    this.cancelled = false;
    this.toolErrorCount = {};

    // Tracing
    this.tracing = tracing;
    console.error('[BaseExecutor] Constructor received tracing config:', {
      enabled: this.tracing?.enabled,
      apiUrl: this.tracing?.apiUrl,
      tenantId: this.tracing?.tenantId,
      promptName: this.tracing?.promptName,
      executionId: this.tracing?.executionId,
      hasServiceKey: !!this.tracing?.serviceKey,
      filters: this.tracing?.filters
    });

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

    // Use tools from manifest directly - no auto-injection
    this.allToolDefs = manifest.toolDefs;
  }

  /**
   * Validate required manifest fields
   */
  protected validateManifest(): void {
    // Check for deprecated chunk format
    if ((this.manifest as any).systemChunks !== undefined) {
      throw new Error(
        '[BaseExecutor] Manifest uses deprecated chunk format. ' +
        'Please re-export prompts with: skej export'
      );
    }

    const required = ['systemMessage', 'userMessage', 'variables', 'toolDefs', 'models'];

    for (const field of required) {
      if (!this.manifest[field as keyof Manifest]) {
        throw new Error(`[BaseExecutor] manifest.${field} is required`);
      }
    }

    if (!this.manifest.models || this.manifest.models.length === 0) {
      throw new Error('[BaseExecutor] manifest.models is required');
    }

    // Validate non-empty strings
    if (!this.manifest.systemMessage || this.manifest.systemMessage.trim() === '') {
      throw new Error('[BaseExecutor] manifest.systemMessage cannot be empty');
    }
    if (!this.manifest.userMessage || this.manifest.userMessage.trim() === '') {
      throw new Error('[BaseExecutor] manifest.userMessage cannot be empty');
    }
  }

  /**
   * Build system instructions from manifest
   * Populates variables in systemMessage
   */
  protected buildInstructions(): string {
    return this.populateTemplate(this.manifest.systemMessage, this.variables);
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
   * Calculate cost in USD based on tokens and model
   * Override this in provider adapters for accurate pricing
   */
  protected calculateCost(inputTokens: number, outputTokens: number): number {
    // Default rough pricing (can be overridden by providers)
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
      console.error('[BaseExecutor] Starting execution');

      // Validate variables
      this.validateVariables();

      // Build initial messages if not provided
      if (this.messages.length === 0) {
        this.messages = this.buildInitialMessages();
      }

      console.error('[BaseExecutor] Invoking LLM with', this.allToolDefs.length, 'tools');

      // First LLM invocation - always require tool call
      const turnStart = Date.now();
      const result = await this.invoke(this.messages, {
        tools: this.allToolDefs,
        tool_choice: 'required'
      });
      const turnDuration = Date.now() - turnStart;

      console.error('[BaseExecutor] LLM responded in', turnDuration, 'ms');
      console.error('[BaseExecutor] Usage:', result.usage);
      console.error('[BaseExecutor] Tool calls:', result.message.tool_calls?.length || 0);

      // Track usage
      const usage: Usage = {
        inputTokens: result.usage?.input_tokens || 0,
        outputTokens: result.usage?.output_tokens || 0,
        totalCostUSD: 0
      };
      usage.totalCostUSD = this.calculateCost(usage.inputTokens, usage.outputTokens);

      console.error('[BaseExecutor] Calculated cost: $', usage.totalCostUSD);

      // Add assistant message to stack
      this.messages.push(result.message);

      // Send trace for this turn
      const turnCost = this.calculateCost(result.usage?.input_tokens || 0, result.usage?.output_tokens || 0);
      await this.sendTurnTrace(result.usage || { input_tokens: 0, output_tokens: 0 }, turnDuration, turnCost);

      // If no toolRouter provided, skip tool loop and return content directly
      const hasExecutableTools = this.toolRouter && Object.keys(this.toolRouter).length > 0;
      let output: any;

      if (!hasExecutableTools) {
        console.error('[BaseExecutor] No toolRouter provided, returning content directly');
        // For prompts without tools, return the text content
        output = result.message.content;
      } else {
        // Process tool calls loop
        output = await this.runToolLoop(result.message, usage);
      }

      console.error('[BaseExecutor] Execution complete');
      console.error('[BaseExecutor] Final usage:', usage);
      console.error('[BaseExecutor] Output:', output);

      return {
        ok: !this.cancelled,
        usage,
        result: output,
        messages: this.messages
      };
    } catch (error: any) {
      console.error('[BaseExecutor] Execution failed:', error.message);
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

    // System message
    messages.push({
      role: 'system',
      content: this.instructions
    });

    // User message
    const populatedContent = this.populateTemplate(this.manifest.userMessage, this.variables);
    messages.push({
      role: 'user',
      content: populatedContent
    });

    return messages;
  }

  /**
   * Tool loop - handle tool calls until completion
   */
  protected async runToolLoop(message: Message, usage: Usage): Promise<any> {
    const terminatingTools = ['finish_agent_run', 'output'];

    console.error('[BaseExecutor] Entering tool loop');

    while (this.hasToolCalls(message)) {
      if (this.cancelled) break;

      console.error('[BaseExecutor] Processing', message.tool_calls?.length, 'tool calls');

      // Execute tool calls
      const toolResults = await this.handleToolCalls(message.tool_calls!);

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
        console.error('[BaseExecutor] Terminating tool called:', terminatingCall.name);
        const terminatingResult = toolResults.find(r => r.tool_call_id === terminatingCall.id);

        // If tool returned error, continue loop
        if (terminatingResult && terminatingResult.content.error) {
          console.error('[BaseExecutor] Terminating tool rejected:', terminatingResult.content.error);
          this.log(`[BaseExecutor] Terminating tool rejected, continuing`);
        } else {
          // Tool accepted, return output
          console.error('[BaseExecutor] Terminating tool accepted, returning:', terminatingCall.args);
          return terminatingCall.args;
        }
      }

      // Next LLM invocation
      // Use 'required' tool_choice to ensure agent always calls a tool in the loop
      console.error('[BaseExecutor] Continuing to next LLM turn');
      const turnStart = Date.now();
      const result = await this.invoke(this.messages, {
        tools: this.allToolDefs,
        tool_choice: 'required'
      });
      const turnDuration = Date.now() - turnStart;

      console.error('[BaseExecutor] LLM responded in', turnDuration, 'ms');
      console.error('[BaseExecutor] Usage:', result.usage);
      console.error('[BaseExecutor] Tool calls:', result.message.tool_calls?.length || 0);

      // Update usage
      usage.inputTokens += result.usage?.input_tokens || 0;
      usage.outputTokens += result.usage?.output_tokens || 0;
      usage.totalCostUSD = this.calculateCost(usage.inputTokens, usage.outputTokens);

      console.error('[BaseExecutor] Accumulated usage:', usage);

      // Add message and continue
      message = result.message;
      this.messages.push(message);

      // Send trace for this turn
      const turnCost = this.calculateCost(result.usage?.input_tokens || 0, result.usage?.output_tokens || 0);
      await this.sendTurnTrace(result.usage || { input_tokens: 0, output_tokens: 0 }, turnDuration, turnCost);

      // Check if we're about to exit the loop
      if (!this.hasToolCalls(message)) {
        console.error('[BaseExecutor] WARNING: Agent responded without tool calls');
        console.error('[BaseExecutor] Last message content:', message.content);
        console.error('[BaseExecutor] Last message tool_calls:', message.tool_calls);
      }
    }

    if (this.cancelled) {
      return { ok: false, status: 'cancelled' };
    }

    // No terminating tool found
    console.error('[BaseExecutor] Exited tool loop without terminating tool');
    console.error('[BaseExecutor] Last message:', JSON.stringify(message, null, 2));
    throw new Error('[BaseExecutor] Agent ended without calling terminating tool');
  }

  /**
   * Handle tool calls - execute sequentially
   */
  protected async handleToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      this.log(`[BaseExecutor] Executing tool: ${toolCall.name}`);

      let toolResult: any;

      // Handle built-in tools internally
      if (toolCall.name === 'finish_agent_run') {
        // Built-in terminating tool - return args directly
        toolResult = toolCall.args;
      } else if (toolCall.name === 'fetch_available_scenarios') {
        toolResult = this.handleFetchAvailableScenarios();
      } else if (toolCall.name === 'fetch_scenario_specific_instructions') {
        toolResult = this.handleFetchScenarioInstructions(toolCall.args);
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

      results.push({
        tool_call_id: toolCall.id,
        content: toolResult
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
    console.error('[BaseExecutor] sendTurnTrace called');
    console.error('[BaseExecutor] Tracing config:', {
      enabled: this.tracing?.enabled,
      apiUrl: this.tracing?.apiUrl,
      tenantId: this.tracing?.tenantId,
      hasServiceKey: !!this.tracing?.serviceKey
    });

    // Skip if tracing is disabled
    if (!this.tracing?.enabled) {
      console.error('[BaseExecutor] Tracing is disabled, skipping');
      return;
    }

    // Skip if required config is missing
    if (!this.tracing.apiUrl || !this.tracing.tenantId || !this.tracing.serviceKey) {
      console.error('[BaseExecutor] Tracing enabled but missing required config');
      this.log('[BaseExecutor] Tracing enabled but missing required config (apiUrl, tenantId, serviceKey)');
      return;
    }

    try {
      const url = `${this.tracing.apiUrl}/tenants/${this.tracing.tenantId}/traces`;

      // Ensure all filter values are strings (DynamoDB requirement)
      const filters = this.tracing.filters ? {
        teamId: this.tracing.filters.teamId ? String(this.tracing.filters.teamId) : undefined,
        userId: this.tracing.filters.userId ? String(this.tracing.filters.userId) : undefined,
        resourceId: this.tracing.filters.resourceId ? String(this.tracing.filters.resourceId) : undefined,
        tags: this.tracing.filters.tags || undefined
      } : {};

      // Get the last assistant message as output (entire message object)
      const lastAssistantMessage = [...this.messages].reverse().find(m => m.role === 'assistant');
      const output = lastAssistantMessage || null;

      // Exclude the last assistant message from messages array (it's in output)
      const lastAssistantIndex = this.messages.lastIndexOf(lastAssistantMessage!);
      const messagesWithoutOutput = lastAssistantIndex >= 0
        ? [...this.messages.slice(0, lastAssistantIndex), ...this.messages.slice(lastAssistantIndex + 1)]
        : this.messages;

      const payload = {
        promptName: this.tracing.promptName || 'unknown',
        executionId: this.tracing.executionId || 'unknown',
        messages: messagesWithoutOutput, // Messages without the last assistant message
        output: output, // Last AI message
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
        tools: this.allToolDefs,
        status: 'completed',
        metadata: {
          turnNumber: this.messages.filter(m => m.role === 'assistant').length
        },
        // Flatten filters into payload (all as strings)
        ...filters
      };

      console.error('[BaseExecutor] Sending trace to:', url);
      console.error('[BaseExecutor] Trace payload:', JSON.stringify(payload, null, 2));

      // Send trace (fire and forget - don't block execution)
      fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.tracing.serviceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      }).then(async (response) => {
        console.error('[BaseExecutor] Trace response status:', response.status);
        if (!response.ok) {
          const text = await response.text();
          console.error('[BaseExecutor] Trace failed:', text);
        } else {
          console.error('[BaseExecutor] Trace sent successfully');
        }
      }).catch(error => {
        console.error('[BaseExecutor] Failed to send turn trace:', error.message);
        this.log('[BaseExecutor] Failed to send turn trace:', error.message);
      });

    } catch (error: any) {
      this.log('[BaseExecutor] Error sending turn trace:', error.message);
    }
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
