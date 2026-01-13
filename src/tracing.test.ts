/**
 * Tracing Tests
 *
 * Test trace payload generation with real manifest data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Manifest } from './types.js';

// Mock Anthropic SDK before importing anything that uses it
const mockCreate = vi.fn().mockResolvedValue({
  id: 'msg_123',
  type: 'message',
  role: 'assistant',
  content: [
    {
      type: 'tool_use',
      id: 'call_123',
      name: 'finish_agent_run',
      input: { summary: 'Done' }
    }
  ],
  model: 'claude-sonnet-4-5',
  stop_reason: 'tool_use',
  usage: { input_tokens: 100, output_tokens: 50 }
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate
    };
  }
}));

// Import after mocks are set up
const { createExecutor } = await import('./executorFactory.js');

describe('Tracing', () => {
  let fetchSpy: any;

  beforeEach(() => {
    // Mock fetch globally
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response);

    // Reset mock call history
    mockCreate.mockClear();
    fetchSpy.mockClear();
  });

  it('should send manifest with blocks in trace payload', async () => {
    // Real collector manifest with blocks (from export API response)
    const manifest: Manifest = {
      name: 'collector',
      category: 'General',
      description: 'Prompt: collector',
      system: [
        {
          name: 'intro',
          content: '{component.intro}\n\n{component.now}\n\n{component.writing_style}'
        },
        {
          name: 'instructions',
          content: '## INSTRUCTIONS\n\nTest instructions here'
        }
      ],
      user: [
        {
          name: 'user_message',
          content: '{combinedPreviousMessages}\n\n{combinedLatestMessages}'
        }
      ],
      blocks: [
        {
          name: 'intro',
          content: '## INTRO\n\nYou are a test assistant.'
        },
        {
          name: 'now',
          content: '## CURRENT DATE AND TIME\n\n{now}'
        },
        {
          name: 'writing_style',
          content: '## WRITING STYLE\n\nYour writing style is: {tenantWritingStyle}'
        }
      ],
      variables: [
        { name: 'now', type: 'string', required: false },
        { name: 'tenantWritingStyle', type: 'string', required: false },
        { name: 'combinedLatestMessages', type: 'string', required: false },
        { name: 'combinedPreviousMessages', type: 'string', required: false }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'finish_agent_run',
            description: 'Signal completion',
            parameters: {
              type: 'object',
              properties: {
                summary: { type: 'string' }
              },
              required: ['summary']
            }
          }
        }
      ],
      models: [
        {
          provider: 'anthropic',
          name: 'claude-sonnet-4-5',
          metadata: {
            temperature: 0.7,
            max_tokens: 4096
          }
        }
      ],
      modelSampling: false,
      scenarios: []
    };

    // Create executor with tracing enabled
    const executor = await createExecutor({
      manifest,
      credentials: {
        anthropic: {
          apiKey: 'test-key'
        }
      },
      variables: {
        now: '2026-01-10',
        tenantWritingStyle: 'casual',
        combinedLatestMessages: 'Hello',
        combinedPreviousMessages: ''
      },
      toolRouter: {
        finish_agent_run: {
          execute: async (args: any) => ({ success: true })
        }
      },
      tracing: {
        enabled: true,
        apiUrl: 'http://localhost:3004',
        tenantId: 'test-tenant',
        serviceKey: 'test-key',
        promptName: 'collector',
        etag: '34ca2df6a29aa35f8b5a661f797d11bf',
        tags: ['test']
      }
    });

    // Execute
    const result = await executor.execute();

    console.log('Execution result:', result);
    console.log('Mock create called:', mockCreate.mock.calls.length);
    console.log('Fetch called:', fetchSpy.mock.calls.length);

    // Wait for async fetch to complete (fire-and-forget)
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('After wait - Fetch called:', fetchSpy.mock.calls.length);

    // Check that fetch was called with trace payload
    expect(fetchSpy).toHaveBeenCalled();

    // Get the fetch call arguments
    const fetchCalls = fetchSpy.mock.calls;
    const traceCalls = fetchCalls.filter((call: any) =>
      call[0].includes('/traces')
    );

    expect(traceCalls.length).toBeGreaterThan(0);

    // Parse the trace payload
    const traceCall = traceCalls[0];
    const tracePayload = JSON.parse(traceCall[1].body);

    // Log the actual payload for debugging
    console.log('Trace payload keys:', Object.keys(tracePayload));
    console.log('Manifest keys:', Object.keys(tracePayload.manifest));
    console.log('Blocks in manifest:', JSON.stringify(tracePayload.manifest.blocks, null, 2));

    // Verify manifest is present
    expect(tracePayload.manifest).toBeDefined();

    // Verify blocks are present in manifest
    expect(tracePayload.manifest.blocks).toBeDefined();
    expect(tracePayload.manifest.blocks).toHaveLength(3);
    expect(tracePayload.manifest.blocks[0].name).toBe('intro');
    expect(tracePayload.manifest.blocks[0].content).toContain('You are a test assistant');
    expect(tracePayload.manifest.blocks[1].name).toBe('now');
    expect(tracePayload.manifest.blocks[2].name).toBe('writing_style');

    // Verify other trace fields
    expect(tracePayload.promptName).toBe('collector');
    expect(tracePayload.etag).toBe('34ca2df6a29aa35f8b5a661f797d11bf');
    expect(tracePayload.variables).toEqual({
      now: '2026-01-10',
      tenantWritingStyle: 'casual',
      combinedLatestMessages: 'Hello',
      combinedPreviousMessages: ''
    });
    expect(tracePayload.manifest.tools).toHaveLength(1);

    // Verify tools field is NOT present (redundant)
    expect(tracePayload.tools).toBeUndefined();
  });

  it('should send traces for built-in tool executions', async () => {
    // Reset mocks completely
    mockCreate.mockReset();
    fetchSpy.mockClear();

    // Re-setup fetch mock
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response);

    const manifest: Manifest = {
      name: 'test-with-scenarios',
      category: 'General',
      description: 'Test prompt with scenarios',
      system: [
        {
          name: 'intro',
          content: 'You are a helpful assistant.'
        }
      ],
      user: [
        {
          name: 'user_message',
          content: 'Help me with {task}'
        }
      ],
      blocks: [],
      variables: [
        { name: 'task', type: 'string', required: true }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'fetch_available_scenarios',
            description: 'Fetch available scenarios',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'fetch_scenario_specific_instructions',
            description: 'Fetch scenario-specific instructions',
            parameters: {
              type: 'object',
              properties: {
                scenarioNames: {
                  type: 'array',
                  items: { type: 'string' }
                }
              },
              required: ['scenarioNames']
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'finish_agent_run',
            description: 'Signal completion',
            parameters: {
              type: 'object',
              properties: {
                summary: { type: 'string' }
              },
              required: ['summary']
            }
          }
        }
      ],
      models: [
        {
          provider: 'anthropic',
          name: 'claude-sonnet-4-5',
          metadata: {}
        }
      ],
      modelSampling: false,
      scenarios: [
        {
          name: 'test-scenario',
          description: 'A test scenario',
          instructions: 'Test instructions here'
        }
      ]
    };

    // Mock the Anthropic SDK to return tool calls for each turn
    mockCreate.mockResolvedValueOnce({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_1',
            name: 'fetch_available_scenarios',
            input: {}
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      .mockResolvedValueOnce({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_2',
            name: 'fetch_scenario_specific_instructions',
            input: { scenarioNames: ['test-scenario'] }
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 }
      })
      .mockResolvedValueOnce({
        id: 'msg_3',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'call_3',
            name: 'finish_agent_run',
            input: { summary: 'All done' }
          }
        ],
        model: 'claude-sonnet-4-5',
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 }
      });

    // Create executor with tracing enabled
    const executor = await createExecutor({
      manifest,
      credentials: {
        anthropic: {
          apiKey: 'test-key'
        }
      },
      variables: {
        task: 'testing'
      },
      toolRouter: {}, // Empty tool router to enable tool loop
      tracing: {
        enabled: true,
        apiUrl: 'http://localhost:3004',
        tenantId: 'test-tenant',
        serviceKey: 'test-key',
        promptName: 'test-with-scenarios',
        etag: 'test-etag',
        tags: ['test']
      }
    });

    // Execute
    const result = await executor.execute();

    // Wait for async fetch to complete (fire-and-forget)
    await new Promise(resolve => setTimeout(resolve, 200));

    // Check that fetch was called for both LLM turns and tool executions
    expect(fetchSpy).toHaveBeenCalled();

    // Get all trace calls
    const traceCalls = fetchSpy.mock.calls.filter((call: any) =>
      call[0].includes('/traces')
    );

    // Should have:
    // - 3 LLM turn traces (one for each invoke)
    // - 3 tool execution traces (fetch_available_scenarios, fetch_scenario_specific_instructions, finish_agent_run)
    expect(traceCalls.length).toBeGreaterThanOrEqual(6);

    // Parse trace payloads
    const tracePayloads = traceCalls.map((call: any) => JSON.parse(call[1].body));

    // Find tool execution traces
    const toolTraces = tracePayloads.filter((p: any) => p.metadata?.toolExecution === true);

    // Should have 3 tool traces
    expect(toolTraces.length).toBe(3);

    // Verify fetch_available_scenarios trace
    const fetchScenariosTrace = toolTraces.find((t: any) => t.metadata.toolName === 'fetch_available_scenarios');
    expect(fetchScenariosTrace).toBeDefined();
    expect(fetchScenariosTrace.output.toolName).toBe('fetch_available_scenarios');
    expect(fetchScenariosTrace.output.output.scenarios).toHaveLength(1);
    expect(fetchScenariosTrace.output.output.scenarios[0].name).toBe('test-scenario');
    expect(fetchScenariosTrace.status).toBe('completed');

    // Verify fetch_scenario_specific_instructions trace
    const fetchInstructionsTrace = toolTraces.find((t: any) => t.metadata.toolName === 'fetch_scenario_specific_instructions');
    expect(fetchInstructionsTrace).toBeDefined();
    expect(fetchInstructionsTrace.output.toolName).toBe('fetch_scenario_specific_instructions');
    expect(fetchInstructionsTrace.output.input.scenarioNames).toEqual(['test-scenario']);
    expect(fetchInstructionsTrace.output.output.scenarios).toHaveLength(1);
    expect(fetchInstructionsTrace.status).toBe('completed');

    // Verify finish_agent_run trace
    const finishTrace = toolTraces.find((t: any) => t.metadata.toolName === 'finish_agent_run');
    expect(finishTrace).toBeDefined();
    expect(finishTrace.output.toolName).toBe('finish_agent_run');
    expect(finishTrace.output.input.summary).toBe('All done');
    expect(finishTrace.status).toBe('completed');
  });
});
