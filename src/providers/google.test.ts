import { describe, it, expect, vi, beforeEach } from 'vitest';
import GoogleExecutor from './google.js';
import type { Manifest, ProviderCredentials } from '../types.js';

// Mock the Google Generative AI SDK
vi.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: vi.fn().mockReturnValue({
        generateContent: vi.fn()
      })
    }))
  };
});

describe('GoogleExecutor', () => {
  let mockManifest: Manifest;
  let mockCredentials: ProviderCredentials;

  beforeEach(() => {
    mockManifest = {
      name: 'test-google',
      category: 'test',
      description: 'Google test prompt',
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
          provider: 'google',
          name: 'gemini-1.5-pro',
          metadata: {
            temperature: 0.7,
            topP: 0.9,
            displayName: 'Gemini 1.5 Pro'
          }
        }
      ],
      modelSampling: false
    };

    mockCredentials = {
      google: {
        apiKey: 'test-api-key'
      }
    };
  });

  describe('constructor', () => {
    it('should throw error if google credentials are missing', () => {
      expect(() => {
        new GoogleExecutor({
          manifest: mockManifest,
          credentials: {}
        });
      }).toThrow('[GoogleExecutor] credentials.google is required');
    });

    it('should throw error if api key is missing', () => {
      expect(() => {
        new GoogleExecutor({
          manifest: mockManifest,
          credentials: {
            google: {} as any
          }
        });
      }).toThrow('[GoogleExecutor] credentials.google.apiKey is required');
    });

    it('should initialize successfully with valid credentials', () => {
      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      expect(executor['provider']).toBe('google');
      expect(executor['model']).toBe('gemini-1.5-pro');
    });

    it('should throw error in browser without dangerouslyAllowBrowser flag', () => {
      // Mock browser environment
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        expect(() => {
          new GoogleExecutor({
            manifest: mockManifest,
            credentials: {
              google: {
                apiKey: 'test-key'
              }
            }
          });
        }).toThrow('Using API keys in the browser is unsafe');
      } finally {
        // Restore
        if (originalWindow === undefined) {
          delete (globalThis as any).window;
        } else {
          (globalThis as any).window = originalWindow;
        }
      }
    });

    it('should allow browser usage with dangerouslyAllowBrowser flag', () => {
      // Mock browser environment
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        const executor = new GoogleExecutor({
          manifest: mockManifest,
          credentials: {
            google: {
              apiKey: 'test-key',
              dangerouslyAllowBrowser: true
            }
          }
        });

        expect(executor['provider']).toBe('google');
      } finally {
        // Restore
        if (originalWindow === undefined) {
          delete (globalThis as any).window;
        } else {
          (globalThis as any).window = originalWindow;
        }
      }
    });
  });

  describe('hasToolCalls', () => {
    it('should return true when message has tool calls', () => {
      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const message = {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', name: 'test_tool', args: {} }
        ]
      } as any;

      expect(executor.hasToolCalls(message)).toBe(true);
    });

    it('should return false when message has no tool calls', () => {
      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const message = {
        role: 'assistant',
        content: 'Hello'
      } as any;

      expect(executor.hasToolCalls(message)).toBe(false);
    });

    it('should return false when tool_calls is undefined', () => {
      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const message = {
        role: 'assistant',
        content: 'Hello',
        tool_calls: undefined
      } as any;

      expect(executor.hasToolCalls(message)).toBe(false);
    });
  });

  describe('invoke', () => {
    it('should call Google API with correct parameters', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello!' }]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5
          }
        }
      });

      (GoogleGenerativeAI as any).mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: mockGenerateContent
        })
      }));

      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const result = await executor.invoke([
        { role: 'user', content: 'Hello' }
      ]);

      expect(mockGenerateContent).toHaveBeenCalled();
      expect(result.message.content).toBe('Hello!');
      expect(result.usage.input_tokens).toBe(10);
      expect(result.usage.output_tokens).toBe(5);
    });

    it('should pass provider-specific parameters', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const mockGetGenerativeModel = vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            candidates: [{
              content: { role: 'model', parts: [{ text: 'Hi' }] }
            }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5
            }
          }
        })
      });

      (GoogleGenerativeAI as any).mockImplementation(() => ({
        getGenerativeModel: mockGetGenerativeModel
      }));

      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      await executor.invoke([{ role: 'user', content: 'Test' }]);

      const modelConfig = mockGetGenerativeModel.mock.calls[0][0];
      expect(modelConfig.temperature).toBe(0.7);
      expect(modelConfig.topP).toBe(0.9);
    });

    it('should include tools when provided', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const mockGetGenerativeModel = vi.fn().mockReturnValue({
        generateContent: vi.fn().mockResolvedValue({
          response: {
            candidates: [{
              content: { role: 'model', parts: [{ text: 'Hi' }] }
            }],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 5
            }
          }
        })
      });

      (GoogleGenerativeAI as any).mockImplementation(() => ({
        getGenerativeModel: mockGetGenerativeModel
      }));

      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const tools = [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' }
              }
            }
          }
        }
      ];

      await executor.invoke([{ role: 'user', content: 'Test' }], { tools });

      const modelConfig = mockGetGenerativeModel.mock.calls[0][0];
      expect(modelConfig.tools).toBeDefined();
      expect(modelConfig.tools[0].functionDeclarations).toHaveLength(1);
      expect(modelConfig.tools[0].functionDeclarations[0].name).toBe('test_tool');
    });

    it('should extract tool calls from response', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'test_tool',
                      args: { query: 'test' }
                    }
                  }
                ]
              }
            }
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5
          }
        }
      });

      (GoogleGenerativeAI as any).mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: mockGenerateContent
        })
      }));

      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const result = await executor.invoke([{ role: 'user', content: 'Test' }]);

      expect(result.message.tool_calls).toHaveLength(1);
      expect(result.message.tool_calls![0].name).toBe('test_tool');
      expect(result.message.tool_calls![0].args).toEqual({ query: 'test' });
    });

    it('should format tool results correctly', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          candidates: [{
            content: { role: 'model', parts: [{ text: 'Done' }] }
          }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5
          }
        }
      });

      (GoogleGenerativeAI as any).mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: mockGenerateContent
        })
      }));

      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const messages = [
        { role: 'user', content: 'Test' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'test_tool', name: 'test_tool', args: { query: 'test' } }
          ]
        },
        {
          role: 'tool',
          tool_call_id: 'test_tool',
          content: '{"result":"success"}'
        }
      ] as any;

      await executor.invoke(messages);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const contents = callArgs.contents;

      // Find the function response
      const functionResponse = contents.find((c: any) => c.role === 'function');
      expect(functionResponse).toBeDefined();
      expect(functionResponse.parts[0].functionResponse.name).toBe('test_tool');
      expect(functionResponse.parts[0].functionResponse.response).toEqual({ result: 'success' });
    });

    it('should return usage information', async () => {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          candidates: [{
            content: { role: 'model', parts: [{ text: 'Response' }] }
          }],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50
          }
        }
      });

      (GoogleGenerativeAI as any).mockImplementation(() => ({
        getGenerativeModel: vi.fn().mockReturnValue({
          generateContent: mockGenerateContent
        })
      }));

      const executor = new GoogleExecutor({
        manifest: mockManifest,
        credentials: mockCredentials
      });

      const result = await executor.invoke([{ role: 'user', content: 'Test' }]);

      expect(result.usage).toEqual({
        input_tokens: 100,
        output_tokens: 50
      });
    });
  });
});
