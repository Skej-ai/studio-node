# @skej/studio

Manifest-based LLM executor with Studio integration and CLI. Execute prompts from Studio API or local files with multi-provider support.

## Installation

```bash
npm install @skej/studio
```

## Features

- **Studio Integration** - Sync prompts from Studio and execute them programmatically
- **CLI Tool** - `skej` command for configuration and prompt export
- **Multi-Provider Support** - Anthropic, OpenAI, AWS Bedrock, DeepSeek
- **Stateless Execution** - No persistent state, pure function execution
- **Type-Safe** - Full TypeScript support with generated types
- **API Mode** - Load prompts from API at runtime or use local files

## Quick Start

### 1. Initialize Configuration

```bash
# Create studio.config.js
skej init

# Or create TypeScript config
skej init --typescript
```

### 2. Configure Credentials

Edit `studio.config.js`:

```javascript
export default {
  tenantId: 'your-tenant-id',
  serviceKey: process.env.STUDIO_SERVICE_KEY || 'sk-xxx',
  apiUrl: 'https://api.studio.skej.com',
  outputDir: './studio/prompts',
  apiMode: false,  // true = load from API, false = load from files
};
```

### 3. Export Prompts (File Mode Only)

```bash
skej export
```

### 4. Execute Prompts

```typescript
import { StudioExecutor } from '@skej/studio';

// Initialize executor once with credentials
const executor = await StudioExecutor.create({
  credentials: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});

// Execute prompts by name
const result = await executor.execute('customer-support-agent', {
  customer_query: 'How do I reset my password?',
  customer_name: 'John Doe',
});

console.log(result.result);
```

## API Mode vs File Mode

### File Mode (apiMode: false) - Recommended for Production

**Pros:**
- ⚡ Fast execution (no API call needed)
- 🔌 Works offline
- 📦 Version controlled (prompts in git)
- 🚀 Lower latency

**Cons:**
- 🔄 Must run `skej export` to update prompts

```javascript
// studio.config.js
export default {
  apiMode: false,
  outputDir: './studio/prompts',
  // ...
};
```

### API Mode (apiMode: true) - Great for Development

**Pros:**
- ✨ Always uses latest prompt version
- 🔄 No export step needed
- ⚡ Instant updates from Studio UI

**Cons:**
- 🌐 Requires API access
- ⏱️ Additional latency per execution

```javascript
// studio.config.js
export default {
  apiMode: true,
  // ...
};
```

You can also override the mode per-execution:

```typescript
// Force API mode for this execution
const result = await executor.execute('my-prompt', variables, { apiMode: true });
```

## Examples

### Basic Usage

```typescript
import { StudioExecutor } from '@skej/studio';

const executor = await StudioExecutor.create({
  credentials: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});

const result = await executor.execute('my-prompt', {
  input: 'Hello world',
});

console.log(result.result);
```

### Multi-Step Execution with Tools

```typescript
import { StudioExecutor } from '@skej/studio';

// Define tool implementations
const toolRouter = {
  query_database: {
    execute: async (params: { query: string }) => {
      // Your database logic
      return { results: [...] };
    },
  },
  generate_chart: {
    execute: async (params: { data: any[] }) => {
      // Your chart generation logic
      return { chart_url: '...' };
    },
  },
};

const executor = await StudioExecutor.create({
  credentials: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
  },
});

const result = await executor.execute(
  'data-analysis-agent',
  { user_question: 'What were our top selling products?' },
  toolRouter
);

console.log(result.result);
```

### Error Handling

```typescript
try {
  const result = await executor.execute('my-prompt', variables);

  if (!result.ok) {
    console.error('Execution failed:', result.error);
  } else {
    console.log('Success:', result.result);
  }
} catch (error) {
  console.error('Executor error:', error.message);
}
```

### Batch Processing

```typescript
const executor = await StudioExecutor.create({
  credentials: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
  },
});

const documents = ['Doc 1...', 'Doc 2...', 'Doc 3...'];

const results = await Promise.all(
  documents.map(doc =>
    executor.execute('document-summarizer', { document: doc })
  )
);

results.forEach((result, i) => {
  console.log(`Document ${i + 1}: ${result.result}`);
});
```

### Express.js API Endpoint

```typescript
import express from 'express';
import { StudioExecutor } from '@skej/studio';

const app = express();
app.use(express.json());

// Initialize executor once on server start
const executor = await StudioExecutor.create({
  credentials: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
});

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    const result = await executor.execute('chat-assistant', {
      user_message: message,
    });

    res.json({
      response: result.result,
      usage: result.usage,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(3000);
```

## Studio API Client

Direct API client for Studio resources:

```typescript
import { StudioApiClient } from '@skej/studio';

const client = new StudioApiClient({
  apiUrl: 'https://api.studio.skej.com',
  serviceKey: 'sk_live_your_service_key_here',
  tenantId: 'tenant_123',
});

// Prompts
const prompts = await client.listPrompts();
const prompt = await client.getPrompt('customer_support');
await client.createPrompt({ promptName: '...', ... });
await client.updatePrompt('customer_support', { description: '...' });
await client.deletePrompt('customer_support');

// Blocks
const blocks = await client.listBlocks();
const block = await client.getBlock('data_validator');
await client.createBlock({ blockName: 'formatter', content: '...', description: '...' });
await client.updateBlock('formatter', { content: '...' });
await client.deleteBlock('formatter');

// Models
const systemModels = await client.listSystemModels();
const tenantModels = await client.listTenantModels();

// Traces
const traces = await client.listTraces({ page: 1, per_page: 50 });
const trace = await client.getTrace('trace_abc123');
```

## Supported Providers

- **Anthropic** - Claude models (Sonnet, Opus, Haiku)
- **OpenAI** - GPT models (GPT-4, GPT-3.5, o1, o3)
- **AWS Bedrock** - Bedrock-hosted models
- **DeepSeek** - DeepSeek R1 and other models

### Credentials

```typescript
credentials: {
  anthropic: {
    apiKey: 'sk-ant-...'
  },
  openai: {
    apiKey: 'sk-proj-...'
  },
  bedrock: {
    region: 'us-east-1',
    accessKeyId: 'AKIA...',      // Optional
    secretAccessKey: '...'        // Optional
  },
  deepseek: {
    apiKey: 'sk-...'
  }
}
```

## StudioExecutor API

### Create Instance

```typescript
const executor = await StudioExecutor.create({
  credentials: {
    anthropic: { apiKey: 'sk-ant-...' },
    openai: { apiKey: 'sk-proj-...' },
  },
  tenantId: 'optional-tenant-override',  // Optional
  config: optionalConfig,                // Optional
});
```

### Execute Prompts

```typescript
// Basic execution
const result = await executor.execute('prompt-name', {
  variable1: 'value1',
  variable2: 'value2',
});

// With tool router
const result = await executor.execute('prompt-name', variables, toolRouter);

// Override API mode
const result = await executor.execute('prompt-name', variables, toolRouter, {
  apiMode: true,
});
```

### List Available Prompts

```typescript
// List all prompts
const prompts = await executor.listPrompts();

// Filter by enabled status
const enabledPrompts = await executor.listPrompts({ enabled: true });

// Filter by multi-step (agents)
const agents = await executor.listPrompts({ multiStep: true });
```

### Get Configuration

```typescript
const config = executor.getConfig();
const tenantId = executor.getTenantId();
```

## Lower-Level API

For advanced use cases:

```typescript
import { createExecutor } from '@skej/studio';

const manifest = {
  systemMessage: 'You are a helpful assistant named {assistantName}.',
  userMessage: 'Help me with: {task}',
  variables: [
    { name: 'assistantName', type: 'string', required: true },
    { name: 'task', type: 'string', required: true }
  ],
  toolDefs: [{
    name: 'finish_agent_run',
    description: 'Complete the execution',
    parameters: {
      type: 'object',
      properties: {
        result: { type: 'string' }
      }
    }
  }],
  models: [{
    provider: 'anthropic',
    name: 'claude-sonnet-4-5-20250929',
    metadata: {
      temperature: 1.0,
      top_p: 0.99
    }
  }]
};

const executor = await createExecutor({
  manifest,
  variables: {
    assistantName: 'Claude',
    task: 'weather lookup'
  },
  toolRouter: {
    finish_agent_run: {
      execute: async (args) => args
    }
  },
  credentials: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY }
  }
});

const result = await executor.execute();
```

## Execution Result

```typescript
{
  ok: true,                    // Success flag
  result: { /* output */ },    // Agent output
  messages: [...],             // Full message history
  usage: {
    inputTokens: 1500,
    outputTokens: 300,
    totalCostUSD: 0.0123
  },
  error: 'error message'       // Only present if ok: false
}
```

## Provider-Specific Notes

### Anthropic
- Claude Sonnet 4.5, Haiku 4.5 don't support `top_p`
- Images must be base64-encoded
- Max image size: 5MB

### OpenAI
- o1, o3 models don't support `temperature` or `top_p`
- o1, o3, GPT-5 support `reasoning_effort` parameter
- Images can be URLs or base64

### Bedrock
- Requires AWS credentials or IAM role
- Model ARNs constructed automatically
- Supports Claude models via Bedrock

### DeepSeek
- OpenAI-compatible API
- Base URL: `https://api.deepseek.com/v1`
- R1 model supports reasoning

## Development

### Testing

```bash
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage
npm run test:ui          # With UI
```

**Test Coverage:** 111 tests with 84%+ coverage

### Building

```bash
npm run build            # Build TypeScript
npm run build:watch      # Watch mode
```

## License

MIT
