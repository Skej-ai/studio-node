/**
 * Export Command
 *
 * Download prompts from Studio and write to local files
 */

import { mkdir, writeFile, rm, mkdtemp, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, resolveOutputDir } from '../utils/config.js';
import { createApiClient } from '../utils/api.js';

interface ExportOptions {
  tenantId?: string;
  serviceKey?: string;
  apiUrl?: string;
  promptName?: string;  // Optional: export single prompt by name
}

/**
 * Sanitize prompt name for filename
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

/**
 * Export a single prompt by name
 */
async function exportSinglePrompt(
  client: any,
  config: any,
  promptName: string,
  apiMode: boolean = false
): Promise<void> {
  try {
    console.log(`📥 Exporting prompt: ${promptName}...`);
    console.log('');

    // Create output directory
    const outputDir = await resolveOutputDir(config.outputDir);
    await mkdir(outputDir, { recursive: true });

    // Export prompt from API
    // Skip version creation in apiMode (prompts loaded at runtime, not for version control)
    process.stdout.write(`   ⬇️  ${promptName}...`);
    const createVersion = !apiMode;
    const exportResponse = await client.exportPrompt(promptName, createVersion);
    const exportedPrompt = exportResponse.data; // { manifest, etag, exportedAt }

    const filename = sanitizeFilename(exportedPrompt.manifest.name);
    const filePath = join(outputDir, `${filename}.json`);

    // Write to file as JSON: { manifest, etag, exportedAt }
    const content = JSON.stringify(exportedPrompt, null, 2);
    await writeFile(filePath, content, 'utf-8');

    process.stdout.write(` ✓\n`);
    console.log('');
    console.log(`✅ Exported ${promptName} to ${filePath}`);
  } catch (error) {
    console.error('');
    console.error(`❌ Export failed: ${(error as Error).message}`);

    if ((error as Error).message.includes('404')) {
      console.error('');
      console.error(`Prompt "${promptName}" not found. Check the prompt name and try again.`);
    }

    process.exit(1);
  }
}

/**
 * Export prompts from Studio
 */
export async function exportCommand(options: ExportOptions): Promise<void> {
  try {
    // Load config from studio.config.js or CLI options
    let config = await loadConfig();

    // Check if config exists or required CLI options are provided
    if (!config) {
      if (!options.tenantId || !options.serviceKey) {
        console.error('❌ No config file found and required options not provided');
        console.error('');
        console.error('Either:');
        console.error('   1. Run: skej init');
        console.error('   2. Provide: --tenant-id and --service-key');
        process.exit(1);
      }

      // Use CLI options
      config = {
        tenantId: options.tenantId,
        serviceKey: options.serviceKey,
        apiUrl: options.apiUrl || 'https://api.studio.skej.com',
        outputDir: './studio/prompts',
        apiMode: false,
      };
    }

    // Override config with CLI options if provided
    if (config) {
      if (options.tenantId) config.tenantId = options.tenantId;
      if (options.serviceKey) config.serviceKey = options.serviceKey;
      if (options.apiUrl) config.apiUrl = options.apiUrl;
    }

    console.log('📦 Exporting prompts from Studio...');
    console.log(`   Tenant: ${config.tenantId}`);
    console.log(`   API: ${config.apiUrl}`);
    console.log('');

    // Create API client
    const client = createApiClient({
      apiUrl: config.apiUrl,
      serviceKey: config.serviceKey,
      tenantId: config.tenantId,
    });

    // Handle single prompt export
    if (options.promptName) {
      await exportSinglePrompt(client, config, options.promptName, config.apiMode);
      return;
    }

    // Create output directory
    const outputDir = await resolveOutputDir(config.outputDir);
    await mkdir(outputDir, { recursive: true });

    // Create temporary directory for extracting zip
    const tempDir = await mkdtemp(join(tmpdir(), 'skej-export-'));

    try {
      // Step 1: Download zip file containing all prompts
      console.log('📥 Downloading prompts as zip...');
      const zipBuffer = await client.exportAllPrompts();
      console.log('✓ Downloaded zip file');
      console.log('');

      // Step 2: Extract zip contents directly to output directory
      console.log('📦 Extracting prompts...');

      // Dynamic import of adm-zip
      let AdmZip;
      try {
        const admZipModule = await import('adm-zip');
        AdmZip = admZipModule.default;
      } catch (error) {
        console.error('❌ Failed to load adm-zip package');
        console.error('   Please install it: npm install adm-zip');
        process.exit(1);
      }

      const zip = new AdmZip(zipBuffer);

      // Extract all files directly to the output directory
      zip.extractAllTo(outputDir, true);

      // Count the extracted JSON files
      const files = await readdir(outputDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      console.log('');
      console.log(`✅ Exported ${jsonFiles.length} prompts to ${outputDir}`);

      jsonFiles.forEach(file => {
        console.log(`   📝 ${file}`);
      });
    } finally {
      // Clean up temp directory
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    console.error('');
    console.error('❌ Export failed:', (error as Error).message);

    if ((error as Error).message.includes('401') || (error as Error).message.includes('403')) {
      console.error('');
      console.error('Authentication/Authorization failed. Please check:');
      console.error('   - Service key is valid (not revoked/expired)');
      console.error('   - Service key has "prompts:execute" scope');
      console.error('   - Tenant ID is correct');
    }

    process.exit(1);
  }
}
