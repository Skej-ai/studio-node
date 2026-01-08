import { describe, it, expect, vi, beforeEach } from 'vitest';
import AnthropicExecutor from './anthropic.js';
import type { Manifest, ProviderCredentials } from '../types.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      }
    }))
  };
});

describe('AnthropicExecutor', () => {
  let mockManifest: Manifest;
  let mockCredentials: ProviderCredentials;

  beforeEach(() => {
    mockManifest = {
      systemMessage: 'You are a helpful assistant.',
      userMessage: 'Help me',
      variables: [],
      toolDefs: [],
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
      anthropic: {
        apiKey: 'test-api-key'
      }
    };
  });

  describe('constructor', () => {
    it('should throw error if anthropic credentials are missing', () => {
      expect(() => {
        new AnthropicExecutor({
          manifest: mockManifest,
          credentials: {}
        });
      }).toThrow('[AnthropicExecutor] credentials.anthropic is required');
    });

    it('should throw error if api key is missing', () => {
      expect(() => {
        new AnthropicExecutor({
          manifest: mockManifest,
          credentials: {
            anthropic: {} as any
          }
        });
      }).toThrow('[AnthropicExecutor] credentials.anthropic.apiKey is required');
    });

    it('should initialize successfully with valid credentials', () => {
      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      expect(executor['provider']).toBe('anthropic');
      expect(executor['model']).toBe('claude-sonnet-4-5');
    });
  });

  describe('hasToolCalls', () => {
    it('should return true when message has tool calls', () => {
      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const message = {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', name: 'test_tool', args: {} }
        ]
      };

      expect(executor.hasToolCalls(message as any)).toBe(true);
    });

    it('should return false when message has no tool calls', () => {
      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const message = {
        role: 'assistant',
        content: 'Hello',
        tool_calls: []
      };

      expect(executor.hasToolCalls(message as any)).toBe(false);
    });

    it('should return false when tool_calls is undefined', () => {
      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const message = {
        role: 'assistant',
        content: 'Hello'
      };

      expect(executor.hasToolCalls(message as any)).toBe(false);
    });
  });

  describe('invoke', () => {
    it('should call Anthropic API with correct parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].messages.create = mockCreate;

      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' }
      ];

      await executor.invoke(messages as any, {});

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-5');
      expect(callArgs.messages).toHaveLength(1); // System message filtered out
      expect(callArgs.messages[0]).toEqual({ role: 'user', content: 'User message' });
    });

    it('should pass provider-specific parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const manifestWithParams = {
        ...mockManifest,
        models: [
          {
            provider: 'anthropic',
            name: 'claude-sonnet-4-5',
            metadata: {
              temperature: 0.7,
              top_p: 0.95,
              maxTokens: 8192,
              displayName: 'Claude Sonnet 4.5'
            }
          }
        ]
      };

      const executor = new AnthropicExecutor({
        manifest: manifestWithParams,
        credentials: mockCredentials
      });

      executor['client'].messages.create = mockCreate;

      await executor.invoke([{ role: 'user', content: 'Test' }] as any, {});

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.7);
      expect(callArgs.top_p).toBe(0.95);
      expect(callArgs.max_tokens).toBe(8192);
    });

    it('should include tools when provided', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].messages.create = mockCreate;

      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: { input: { type: 'string' } }
            }
          }
        }
      ];

      await executor.invoke([{ role: 'user', content: 'Test' }] as any, { tools });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe('test_tool');
      expect(callArgs.tools[0].description).toBe('A test tool');
      expect(callArgs.tools[0].input_schema).toBeDefined();
    });

    it('should extract text content from response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' }
        ],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].messages.create = mockCreate;

      const result = await executor.invoke([{ role: 'user', content: 'Test' }] as any, {});

      expect(result.message.content).toBe('First part\nSecond part');
    });

    it('should extract tool calls from response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'test_tool',
            input: { arg1: 'value1' }
          }
        ],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].messages.create = mockCreate;

      const result = await executor.invoke([{ role: 'user', content: 'Test' }] as any, {});

      expect(result.message.tool_calls).toHaveLength(1);
      expect(result.message.tool_calls![0]).toEqual({
        id: 'call_1',
        name: 'test_tool',
        args: { arg1: 'value1' }
      });
    });

    it('should format tool results correctly', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello' }],
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const executor = new AnthropicExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].messages.create = mockCreate;

      const messages = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User' },
        { role: 'assistant', content: 'Assistant' },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: JSON.stringify({ result: 'success' })
        }
      ];

      await executor.invoke(messages as any, {});

      const callArgs = mockCreate.mock.calls[0][0];
      // Should have user, assistant, and tool result (as user role)
      expect(callArgs.messages.length).toBeGreaterThan(0);

      // Find the tool result message (formatted as user role with tool_result)
      const toolResultMessage = callArgs.messages.find((m: any) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content[0]?.type === 'tool_result'
      );

      expect(toolResultMessage).toBeDefined();
      expect(toolResultMessage.content[0].tool_use_id).toBe('call_1');
    });
  });
});
