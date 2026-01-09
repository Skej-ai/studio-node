import { describe, it, expect, vi, beforeEach } from 'vitest';
import BaseExecutor from './BaseExecutor.js';
import type { Manifest, ToolRouter, ProviderCredentials } from './types.js';

// Test executor that implements abstract methods
class TestExecutor extends BaseExecutor {
  async invoke(messages: any[], _options: any) {
    return {
      message: {
        role: 'assistant',
        content: 'Test response',
        tool_calls: []
      },
      usage: {
        input_tokens: 10,
        output_tokens: 5
      }
    };
  }

  hasToolCalls(message: any) {
    return Boolean(message?.tool_calls && message.tool_calls.length > 0);
  }
}

describe('BaseExecutor', () => {
  let mockManifest: Manifest;
  let mockToolRouter: ToolRouter;
  let mockCredentials: ProviderCredentials;

  beforeEach(() => {
    mockManifest = {
      name: 'test-prompt',
      category: 'test',
      description: 'Test prompt',
      system: [
        { name: 'main', content: 'You are a helpful assistant named {assistantName}.' }
      ],
      user: [
        { name: 'main', content: 'Help with: {task}' }
      ],
      blocks: [],
      variables: [
        { name: 'assistantName', type: 'string', required: true },
        { name: 'task', type: 'string', required: true }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string' }
              },
              required: ['input']
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
      ],
      modelSampling: false
    };

    mockToolRouter = {
      test_tool: {
        execute: vi.fn(async () => ({ success: true }))
      }
    };

    mockCredentials = {
      anthropic: {
        apiKey: 'test-key'
      }
    };
  });

  describe('constructor', () => {
    it('should throw error if manifest is missing', () => {
      expect(() => {
        new TestExecutor({ manifest: null as any, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest is required');
    });

    it('should throw error if system is missing', () => {
      const invalidManifest = { ...mockManifest };
      delete (invalidManifest as any).system;

      expect(() => {
        new TestExecutor({ manifest: invalidManifest, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest.system is required');
    });

    it('should throw error if user is missing', () => {
      const invalidManifest = { ...mockManifest };
      delete (invalidManifest as any).user;

      expect(() => {
        new TestExecutor({ manifest: invalidManifest, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest.user is required');
    });

    it('should throw error if variables is missing', () => {
      const invalidManifest = { ...mockManifest };
      delete (invalidManifest as any).variables;

      expect(() => {
        new TestExecutor({ manifest: invalidManifest, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest.variables is required');
    });

    it('should throw error if tools is missing', () => {
      const invalidManifest = { ...mockManifest };
      delete (invalidManifest as any).tools;

      expect(() => {
        new TestExecutor({ manifest: invalidManifest, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest.tools is required');
    });

    it('should throw error if models is missing', () => {
      const invalidManifest = { ...mockManifest };
      delete (invalidManifest as any).models;

      expect(() => {
        new TestExecutor({ manifest: invalidManifest, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest.models is required');
    });

    it('should throw error if models array is empty', () => {
      const invalidManifest = {
        ...mockManifest,
        models: []
      };

      expect(() => {
        new TestExecutor({ manifest: invalidManifest, credentials: mockCredentials });
      }).toThrow('[BaseExecutor] manifest.models is required');
    });

    it('should initialize successfully with valid manifest', () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['manifest']).toBe(mockManifest);
      expect(executor['provider']).toBe('anthropic');
      expect(executor['model']).toBe('claude-sonnet-4-5');
      expect(executor['primaryModelConfig'].metadata.temperature).toBe(1.0);
    });

    it('should store scenarios when they exist', () => {
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

      const executor = new TestExecutor({
        manifest: manifestWithScenarios,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['scenarios']).toHaveLength(1);
      expect(executor['allToolDefs']).toHaveLength(2); // Only manifest tools (no auto-injection)
    });

    it('should not have scenarios when scenarios is empty', () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['scenarios']).toHaveLength(0);
      expect(executor['allToolDefs']).toHaveLength(2); // Only manifest tools
    });
  });

  describe('variable validation', () => {
    it('should throw error if required variable is missing', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude' }, // Missing 'task'
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      const result = await executor.execute();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Required variable missing: task');
    });

    it('should not throw error if optional variable is missing', async () => {
      const manifestWithOptional = {
        ...mockManifest,
        variables: [
          { name: 'assistantName', type: 'string', required: true },
          { name: 'task', type: 'string', required: true },
          { name: 'optional', type: 'string', required: false }
        ]
      };

      const executor = new TestExecutor({
        manifest: manifestWithOptional,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Override invoke to return message without tool calls
      executor.invoke = vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'Done', tool_calls: [] },
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      // Should return error because no terminating tool was called, but not about missing variable
      const result = await executor.execute();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Agent ended without calling terminating tool');
    });

    it('should accept all variables when present', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Override invoke to return finish_agent_run call
      executor.invoke = vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'finish_agent_run',
              args: { result: 'success' }
            }
          ]
        },
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const result = await executor.execute();
      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 'success' });
    });
  });

  describe('template population', () => {
    it('should populate variables in system chunks', () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'TestBot', task: 'help' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['instructions']).toBe('You are a helpful assistant named TestBot.');
    });

    it('should leave unpopulated variables as-is', () => {
      const manifestWithExtra = {
        ...mockManifest,
        system: [
          { name: 'main', content: 'Name: {assistantName}, Missing: {missing}' }
        ]
      };

      const executor = new TestExecutor({
        manifest: manifestWithExtra,
        variables: { assistantName: 'TestBot', task: 'help' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['instructions']).toBe('Name: TestBot, Missing: {missing}');
    });

    it('should populate multiple variables in same string', () => {
      const manifestWithMultiple = {
        ...mockManifest,
        system: [
          { name: 'main', content: 'Assistant {assistantName} will help with {task}.' }
        ]
      };

      const executor = new TestExecutor({
        manifest: manifestWithMultiple,
        variables: { assistantName: 'Claude', task: 'coding' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['instructions']).toBe('Assistant Claude will help with coding.');
    });
  });

  describe('scenario tool handlers', () => {
    let executor: TestExecutor;

    beforeEach(() => {
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

      executor = new TestExecutor({
        manifest: manifestWithScenarios,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });
    });

    it('should handle fetch_available_scenarios', () => {
      const result = executor['handleFetchAvailableScenarios']();

      expect(result.completed).toBe(true);
      expect(result.scenarios).toHaveLength(2);
      expect(result.scenarios[0]).toEqual({
        name: 'booking',
        description: 'Handle booking'
      });
      expect(result.scenarios[1]).toEqual({
        name: 'cancellation',
        description: 'Handle cancellation'
      });
    });

    it('should handle fetch_scenario_specific_instructions with valid scenarios', () => {
      const result = executor['handleFetchScenarioInstructions']({
        scenarioNames: ['booking', 'cancellation']
      });

      expect(result.completed).toBe(true);
      expect(result.scenarios).toHaveLength(2);
      expect(result.scenarios[0]).toEqual({
        name: 'booking',
        instructions: 'Follow booking flow'
      });
      expect(result.scenarios[1]).toEqual({
        name: 'cancellation',
        instructions: 'Follow cancellation flow'
      });
    });

    it('should return error for non-existent scenarios', () => {
      const result = executor['handleFetchScenarioInstructions']({
        scenarioNames: ['booking', 'nonexistent']
      });

      expect(result.completed).toBe(false);
      expect(result.error).toBe(true);
      expect(result.message).toBe('Scenarios not found: nonexistent');
    });

    it('should return error for invalid scenarioNames parameter', () => {
      const result = executor['handleFetchScenarioInstructions']({
        scenarioNames: 'not-an-array'
      });

      expect(result.completed).toBe(false);
      expect(result.error).toBe(true);
      expect(result.message).toBe('scenarioNames must be an array');
    });

    it('should return error for missing scenarioNames', () => {
      const result = executor['handleFetchScenarioInstructions']({});

      expect(result.completed).toBe(false);
      expect(result.error).toBe(true);
      expect(result.message).toBe('scenarioNames must be an array');
    });
  });

  describe('cancel', () => {
    it('should set cancelled flag and return true', () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      expect(executor['cancelled']).toBe(false);
      const result = executor.cancel();
      expect(result).toBe(true);
      expect(executor['cancelled']).toBe(true);
    });

    it('should stop execution when cancelled', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Override invoke to return tool call
      executor.invoke = vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'test_tool',
              args: { input: 'test' }
            }
          ]
        },
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      // Cancel immediately
      executor.cancel();

      const result = await executor.execute();
      expect(result.ok).toBe(false);
      expect(result.result).toEqual({ ok: false, status: 'cancelled' });
    });
  });

  describe('tool execution', () => {
    it('should call tool from toolRouter', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      const toolCalls = [
        {
          id: 'call_1',
          name: 'test_tool',
          args: { input: 'test' }
        }
      ];

      const results = await executor['handleToolCalls'](toolCalls);

      expect(mockToolRouter.test_tool.execute).toHaveBeenCalledWith({ input: 'test' });
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        tool_call_id: 'call_1',
        content: { success: true }
      });
    });

    it('should return error for missing tool', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: {},
        credentials: mockCredentials
      });

      const toolCalls = [
        {
          id: 'call_1',
          name: 'nonexistent_tool',
          args: {}
        }
      ];

      const results = await executor['handleToolCalls'](toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].content).toEqual({
        completed: false,
        error: true,
        message: "Tool 'nonexistent_tool' not found"
      });
    });

    it('should handle tool errors gracefully', async () => {
      const failingRouter = {
        test_tool: {
          execute: vi.fn().mockRejectedValue(new Error('Tool failed'))
        }
      };

      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: failingRouter,
        credentials: mockCredentials
      });

      const toolCalls = [
        {
          id: 'call_1',
          name: 'test_tool',
          args: { input: 'test' }
        }
      ];

      const results = await executor['handleToolCalls'](toolCalls);

      expect(results).toHaveLength(1);
      expect(results[0].content).toEqual({
        completed: false,
        error: true,
        message: 'An error occurred while executing this tool. Please try a different approach.'
      });
    });

    it('should throw after 3 consecutive tool errors', async () => {
      const failingRouter = {
        test_tool: {
          execute: vi.fn().mockRejectedValue(new Error('Tool failed'))
        }
      };

      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: failingRouter,
        credentials: mockCredentials
      });

      const toolCalls = [
        { id: 'call_1', name: 'test_tool', args: {} }
      ];

      // First call
      await executor['handleToolCalls'](toolCalls);
      expect(executor['toolErrorCount'].test_tool).toBe(1);

      // Second call
      await executor['handleToolCalls'](toolCalls);
      expect(executor['toolErrorCount'].test_tool).toBe(2);

      // Third call should throw
      await expect(executor['handleToolCalls'](toolCalls)).rejects.toThrow('Tool failed');
    });

    it('should reset error count on successful tool call', async () => {
      let callCount = 0;
      const flakeyRouter = {
        test_tool: {
          execute: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) throw new Error('First fail');
            return { success: true };
          })
        }
      };

      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: flakeyRouter,
        credentials: mockCredentials
      });

      const toolCalls = [
        { id: 'call_1', name: 'test_tool', args: {} }
      ];

      // First call fails
      await executor['handleToolCalls'](toolCalls);
      expect(executor['toolErrorCount'].test_tool).toBe(1);

      // Second call succeeds
      const results = await executor['handleToolCalls'](toolCalls);
      expect(executor['toolErrorCount'].test_tool).toBe(0);
      expect(results[0].content).toEqual({ success: true });
    });
  });

  describe('full execution flow', () => {
    it('should execute successfully with terminating tool', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Override invoke to return finish_agent_run
      executor.invoke = vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'finish_agent_run',
              args: { result: 'success', data: { value: 42 } }
            }
          ]
        },
        usage: { input_tokens: 100, output_tokens: 50 }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 'success', data: { value: 42 } });
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.totalCostUSD).toBeGreaterThan(0); // Cost calculated based on tokens
      expect(result.messages.length).toBeGreaterThan(0);
    });

    it('should handle multi-turn execution', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      let invocationCount = 0;
      executor.invoke = vi.fn().mockImplementation(async () => {
        invocationCount++;

        if (invocationCount === 1) {
          // First call - call test_tool
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  name: 'test_tool',
                  args: { input: 'test' }
                }
              ]
            },
            usage: { input_tokens: 50, output_tokens: 25 }
          };
        } else {
          // Second call - finish
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_2',
                  name: 'finish_agent_run',
                  args: { result: 'done' }
                }
              ]
            },
            usage: { input_tokens: 60, output_tokens: 30 }
          };
        }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ result: 'done' });
      expect(result.usage.inputTokens).toBe(110); // 50 + 60
      expect(result.usage.outputTokens).toBe(55); // 25 + 30
      expect(result.usage.totalCostUSD).toBeGreaterThan(0); // Cost calculated based on tokens
      expect(mockToolRouter.test_tool.execute).toHaveBeenCalled();
    });

    it('should throw error if no terminating tool is called', async () => {
      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials
      });

      // Return message with no tool calls
      executor.invoke = vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: 'Just text',
          tool_calls: []
        },
        usage: { input_tokens: 10, output_tokens: 5 }
      });

      const result = await executor.execute();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Agent ended without calling terminating tool');
    });
  });

  describe('onToolCall callback', () => {
    it('should call onToolCall callback for non-terminating tools', async () => {
      const onToolCall = vi.fn().mockResolvedValue({});

      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials,
        onToolCall
      });

      let invocationCount = 0;
      executor.invoke = vi.fn().mockImplementation(async () => {
        invocationCount++;

        if (invocationCount === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  name: 'test_tool',
                  args: { input: 'test' }
                }
              ]
            },
            usage: { input_tokens: 50, output_tokens: 25 }
          };
        } else {
          return {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_2',
                  name: 'finish_agent_run',
                  args: { result: 'done' }
                }
              ]
            },
            usage: { input_tokens: 60, output_tokens: 30 }
          };
        }
      });

      await executor.execute();

      expect(onToolCall).toHaveBeenCalledTimes(1);
      expect(onToolCall).toHaveBeenCalledWith({
        toolCall: expect.objectContaining({
          id: 'call_1',
          name: 'test_tool',
          args: { input: 'test' }
        }),
        toolResponse: { success: true }
      });
    });

    it('should abort when callback returns abort: true', async () => {
      const onToolCall = vi.fn().mockResolvedValue({ abort: true });

      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials,
        onToolCall
      });

      executor.invoke = vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'test_tool',
              args: { input: 'test' }
            }
          ]
        },
        usage: { input_tokens: 50, output_tokens: 25 }
      });

      const result = await executor.execute();

      expect(result.ok).toBe(false);
      expect(result.result).toEqual({ ok: false, status: 'cancelled' });
      expect(onToolCall).toHaveBeenCalled();
    });

    it('should not call callback for terminating tools', async () => {
      const onToolCall = vi.fn().mockResolvedValue({});

      const executor = new TestExecutor({
        manifest: mockManifest,
        variables: { assistantName: 'Claude', task: 'testing' },
        toolRouter: mockToolRouter,
        credentials: mockCredentials,
        onToolCall
      });

      executor.invoke = vi.fn().mockResolvedValue({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              name: 'finish_agent_run',
              args: { result: 'done' }
            }
          ]
        },
        usage: { input_tokens: 50, output_tokens: 25 }
      });

      await executor.execute();

      expect(onToolCall).not.toHaveBeenCalled();
    });
  });
});
