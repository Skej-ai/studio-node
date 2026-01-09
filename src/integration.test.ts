import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createExecutor } from './executorFactory.js';
import type { Manifest, ProviderCredentials, ToolRouter } from './types.js';

// Mock all provider SDKs
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() }
  }))
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } }
  }))
}));

vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: vi.fn()
  })),
  ConverseCommand: vi.fn()
}));

describe('Integration Tests', () => {
  let mockManifest: Manifest;
  let mockCredentials: ProviderCredentials;
  let mockToolRouter: ToolRouter;

  beforeEach(() => {
    mockManifest = {
      systemMessage: 'You are an assistant that helps with {task}.',
      userMessage: 'User: {userMessage}',
      variables: [
        { name: 'task', type: 'string', required: true },
        { name: 'userMessage', type: 'string', required: true }
      ],
      toolDefs: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search for information',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              },
              required: ['query']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'finish_agent_run',
            description: 'Complete execution',
            parameters: {
              type: 'object',
              properties: {
                result: { type: 'string' }
              }
            }
          }
        }
      ],
      models: [
        {
          provider: 'anthropic',
          name: 'claude-sonnet-4-5',
          metadata: {
            temperature: 1.0,
            maxTokens: 4096,
            displayName: 'Claude Sonnet 4.5'
          }
        }
      ]
    };

    mockCredentials = {
      anthropic: { apiKey: 'test-key' },
      openai: { apiKey: 'test-key' }
    };

    mockToolRouter = {
      search: {
        execute: vi.fn().mockResolvedValue({
          results: ['Result 1', 'Result 2']
        })
      }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createExecutor', () => {
    it('should create Anthropic executor', async () => {
      const executor = await createExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      expect(executor).toBeDefined();
      expect(executor['provider']).toBe('anthropic');
    });

    it('should create OpenAI executor', async () => {
      const openaiManifest = {
        ...mockManifest,
        models: [{
          provider: 'openai',
          name: 'gpt-4',
          metadata: {
            temperature: 0.7,
            max_tokens: 4096,
            displayName: 'GPT-4'
          }
        }]
      };

      const executor = await createExecutor({
        manifest: openaiManifest,
        credentials: mockCredentials
      });

      expect(executor).toBeDefined();
      expect(executor['provider']).toBe('openai');
    });

    it('should throw error for unsupported provider', async () => {
      const invalidManifest = {
        ...mockManifest,
        models: [{
          provider: 'invalid',
          name: 'test-model',
          metadata: {}
        }]
      };

      await expect(
        createExecutor({
          manifest: invalidManifest as any,
          credentials: mockCredentials
        })
      ).rejects.toThrow('[executorFactory] Unsupported provider: invalid');
    });
  });

  describe('Full execution flow with Anthropic', () => {
    it('should complete multi-step execution', async () => {
      const executor = await createExecutor({
        manifest: mockManifest,
        variables: {
          task: 'searching',
          userMessage: 'Find information about AI'
        },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Mock Anthropic API responses
      let callCount = 0;
      executor['client'].messages.create = vi.fn().mockImplementation(async () => {
        callCount++;

        if (callCount === 1) {
          // First call - use search tool
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'search',
                input: { query: 'AI information' }
              }
            ],
            usage: { input_tokens: 100, output_tokens: 50 }
          };
        } else {
          // Second call - finish
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_2',
                name: 'finish_agent_run',
                input: { result: 'Found AI information' }
              }
            ],
            usage: { input_tokens: 150, output_tokens: 30 }
          };
        }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 'Found AI information' });
      expect(result.usage.inputTokens).toBe(250); // 100 + 150
      expect(result.usage.outputTokens).toBe(80); // 50 + 30
      expect(mockToolRouter.search.execute).toHaveBeenCalledWith({ query: 'AI information' });
    });

    it('should handle tool errors gracefully', async () => {
      const failingRouter = {
        search: {
          execute: vi.fn().mockRejectedValue(new Error('Search failed'))
        }
      };

      const executor = await createExecutor({
        manifest: mockManifest,
        variables: {
          task: 'searching',
          userMessage: 'Test'
        },
        toolRouter: failingRouter,
        credentials: mockCredentials
      });

      let callCount = 0;
      executor['client'].messages.create = vi.fn().mockImplementation(async () => {
        callCount++;

        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'search',
                input: { query: 'test' }
              }
            ],
            usage: { input_tokens: 50, output_tokens: 25 }
          };
        } else {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_2',
                name: 'finish_agent_run',
                input: { result: 'Handled error' }
              }
            ],
            usage: { input_tokens: 60, output_tokens: 30 }
          };
        }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(true);
      expect(failingRouter.search.execute).toHaveBeenCalled();
      // Should recover from error and finish
      expect(result.result).toEqual({ result: 'Handled error' });
    });

    it('should respect onToolCall callback', async () => {
      const onToolCall = vi.fn().mockResolvedValue({});

      const executor = await createExecutor({
        manifest: mockManifest,
        variables: {
          task: 'searching',
          userMessage: 'Test'
        },
        toolRouter: mockToolRouter,
        credentials: mockCredentials,
        onToolCall
      });

      let callCount = 0;
      executor['client'].messages.create = vi.fn().mockImplementation(async () => {
        callCount++;

        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'search',
                input: { query: 'test' }
              }
            ],
            usage: { input_tokens: 50, output_tokens: 25 }
          };
        } else {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_2',
                name: 'finish_agent_run',
                input: { result: 'Done' }
              }
            ],
            usage: { input_tokens: 60, output_tokens: 30 }
          };
        }
      });

      await executor.execute();

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith({
        toolCall: expect.objectContaining({
          name: 'search',
          args: { query: 'test' }
        }),
        toolResponse: expect.objectContaining({
          results: ['Result 1', 'Result 2']
        })
      });
    });

    it('should abort when callback returns abort: true', async () => {
      const onToolCall = vi.fn().mockResolvedValue({ abort: true });

      const executor = await createExecutor({
        manifest: mockManifest,
        variables: {
          task: 'searching',
          userMessage: 'Test'
        },
        toolRouter: mockToolRouter,
        credentials: mockCredentials,
        onToolCall
      });

      executor['client'].messages.create = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'search',
            input: { query: 'test' }
          }
        ],
        usage: { input_tokens: 50, output_tokens: 25 }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(false);
      expect(onToolCall).toHaveBeenCalled();
    });
  });

  describe('Scenario handling', () => {
    it('should store scenarios from manifest', async () => {
      const manifestWithScenarios = {
        ...mockManifest,
        scenarios: [
          {
            name: 'booking',
            description: 'Handle booking',
            instructions: 'Follow booking flow'
          }
        ]
      };

      const executor = await createExecutor({
        manifest: manifestWithScenarios,
        variables: {
          task: 'booking',
          userMessage: 'Book a flight'
        },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Should only have manifest tools (no auto-injection)
      expect(executor['allToolDefs']).toHaveLength(2);
      expect(executor['scenarios']).toHaveLength(1);
      expect(executor['scenarios'][0].name).toBe('booking');
    });

    it('should handle fetch_available_scenarios during execution', async () => {
      const manifestWithScenarios = {
        ...mockManifest,
        scenarios: [
          {
            name: 'booking',
            description: 'Handle booking',
            instructions: 'Follow booking flow'
          },
          {
            name: 'cancellation',
            description: 'Handle cancellation',
            instructions: 'Follow cancellation flow'
          }
        ]
      };

      const executor = await createExecutor({
        manifest: manifestWithScenarios,
        variables: {
          task: 'booking',
          userMessage: 'Help me'
        },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      let callCount = 0;
      executor['client'].messages.create = vi.fn().mockImplementation(async () => {
        callCount++;

        if (callCount === 1) {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'fetch_available_scenarios',
                input: {}
              }
            ],
            usage: { input_tokens: 50, output_tokens: 25 }
          };
        } else {
          return {
            content: [
              {
                type: 'tool_use',
                id: 'call_2',
                name: 'finish_agent_run',
                input: { result: 'Listed scenarios' }
              }
            ],
            usage: { input_tokens: 60, output_tokens: 30 }
          };
        }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 'Listed scenarios' });
    });
  });

  describe('Variable validation', () => {
    it('should throw error for missing required variables', async () => {
      const executor = await createExecutor({
        manifest: mockManifest,
        variables: {
          task: 'searching'
          // Missing userMessage
        },
        credentials: mockCredentials
      });

      const result = await executor.execute();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Required variable missing: userMessage');
    });

    it('should populate variables in prompts', async () => {
      const executor = await createExecutor({
        manifest: mockManifest,
        variables: {
          task: 'coding',
          userMessage: 'Write some code'
        },
        credentials: mockCredentials
      });

      expect(executor['instructions']).toBe('You are an assistant that helps with coding.');

      // Build initial messages to check user message
      const messages = executor['buildInitialMessages']();
      expect(messages[1].content).toBe('User: Write some code');
    });
  });
});
