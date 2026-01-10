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
});
