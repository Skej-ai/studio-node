import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAIExecutor from './openai.js';
import type { Manifest, ProviderCredentials } from '../types.js';

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn()
        }
      }
    }))
  };
});

describe('OpenAIExecutor', () => {
  let mockManifest: Manifest;
  let mockCredentials: ProviderCredentials;

  beforeEach(() => {
    mockManifest = {
      name: 'test-openai',
      category: 'test',
      description: 'OpenAI test prompt',
      system: [
        { name: 'main', content: 'You are a helpful assistant.' }
      ],
      user: [
        { name: 'main', content: 'Help me' }
      ],
      blocks: [],
      variables: [],
      tools: [],
      models: [
        {
          provider: 'openai',
          name: 'gpt-4',
          metadata: {
            temperature: 0.7,
            max_tokens: 4096,
            displayName: 'GPT-4'
          }
        }
      ],
      modelSampling: false
    };

    mockCredentials = {
      openai: {
        apiKey: 'test-api-key'
      }
    };
  });

  describe('constructor', () => {
    it('should throw error if openai credentials are missing', () => {
      expect(() => {
        new OpenAIExecutor({
          manifest: mockManifest,
          credentials: {}
        });
      }).toThrow('[OpenAIExecutor] credentials.openai is required');
    });

    it('should throw error if api key is missing', () => {
      expect(() => {
        new OpenAIExecutor({
          manifest: mockManifest,
          credentials: {
            openai: {} as any
          }
        });
      }).toThrow('[OpenAIExecutor] credentials.openai.apiKey is required');
    });

    it('should initialize successfully with valid credentials', () => {
      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      expect(executor['provider']).toBe('openai');
      expect(executor['model']).toBe('gpt-4');
    });
  });

  describe('hasToolCalls', () => {
    it('should return true when message has tool calls', () => {
      const executor = new OpenAIExecutor({
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
      const executor = new OpenAIExecutor({
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
    it('should call OpenAI API with correct parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello'
            }
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5
        }
      });

      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

      const messages = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User message' }
      ];

      await executor.invoke(messages as any, {});

      expect(mockCreate).toHaveBeenCalled();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('gpt-4');
      expect(callArgs.messages).toHaveLength(2);
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'System prompt' });
      expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'User message' });
    });

    it('should pass provider-specific parameters', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const manifestWithParams = {
        ...mockManifest,
        models: [
          {
            provider: 'openai',
            name: 'gpt-4o',
            metadata: {
              temperature: 0.8,
              top_p: 0.9,
              reasoning: { effort: 'high' },
              max_tokens: 8192,
              displayName: 'GPT-4o'
            }
          }
        ]
      };

      const executor = new OpenAIExecutor({
        manifest: manifestWithParams,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

      await executor.invoke([{ role: 'user', content: 'Test' }] as any, {});

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0.8);
      expect(callArgs.top_p).toBe(0.9);
      expect(callArgs.reasoning).toEqual({ effort: 'high' });
    });

    it('should include tools when provided', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

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
      expect(callArgs.tools[0].type).toBe('function');
      expect(callArgs.tools[0].function.name).toBe('test_tool');
    });

    it('should extract tool calls from response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ arg1: 'value1' })
                  }
                }
              ]
            }
          }
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

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
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

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
      expect(callArgs.messages.length).toBe(4);

      const toolMessage = callArgs.messages[3];
      expect(toolMessage.role).toBe('tool');
      expect(toolMessage.tool_call_id).toBe('call_1');
    });

    it('should return usage information', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: 'Hello' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 }
      });

      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

      const result = await executor.invoke([{ role: 'user', content: 'Test' }] as any, {});

      expect(result.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50
      });
    });

    it('should handle empty content', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{ message: { role: 'assistant', content: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      });

      const executor = new OpenAIExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      executor['client'].chat.completions.create = mockCreate;

      const result = await executor.invoke([{ role: 'user', content: 'Test' }] as any, {});

      expect(result.message.content).toBe('');
    });
  });
});
