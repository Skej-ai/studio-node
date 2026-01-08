# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-01-08

### Added
- Initial release of @skej/studio
- StudioExecutor for executing prompts from Studio API or local files
- Support for API mode (runtime loading) and File mode (pre-exported)
- Multi-provider support: Anthropic, OpenAI, AWS Bedrock, DeepSeek
- CLI tool (`skej`) for configuration and prompt export
- StudioApiClient for direct API access to Studio resources
- Built-in tool routing and multi-step execution support
- Comprehensive test suite with 84%+ coverage
- TypeScript support with full type definitions
- Stateless execution pattern - no persistent state
- Universal tracing integration
- Batch processing support
- Examples for basic usage, tools, error handling, and Express.js integration

### Features
- `skej init` - Initialize configuration
- `skej export` - Export prompts from Studio API to local files
- Execute prompts by name with variable substitution
- List available prompts/agents with filtering
- Support for images, audio, and other file attachments
- Provider-specific parameter handling
- Model sampling and fallback support
- Detailed usage tracking and cost calculation

[1.0.0]: https://github.com/skej/studio-node/releases/tag/v1.0.0
