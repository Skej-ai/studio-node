#!/usr/bin/env node
/**
 * Studio CLI
 *
 * Command-line interface for Studio prompt management
 * Combined with executor package for unified prompt execution and management
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { exportCommand } from './commands/export.js';

const program = new Command();

program
  .name('skej')
  .description('Studio CLI - Manage and execute LLM prompts')
  .version('1.0.0');

// Initialize studio.config.js or studio.config.ts
program
  .command('init')
  .description('Initialize Studio configuration file')
  .option('--api-url <url>', 'API URL', 'https://api.skej.com')
  .option('--output-dir <dir>', 'Output directory for prompts', './studio/prompts')
  .option('--typescript', 'Create TypeScript config file (studio.config.ts)')
  .action(initCommand);

// Export/download prompts from Studio
program
  .command('export')
  .alias('pull')
  .alias('download')
  .description('Export prompts from Studio to local files')
  .option('--tenant-id <id>', 'Tenant ID')
  .option('--service-key <key>', 'Service key (sk-xxx)')
  .option('--api-url <url>', 'API URL override')
  .option('--prompt-name <name>', 'Export single prompt by name (optional)')
  .action(exportCommand);

program.parse();
