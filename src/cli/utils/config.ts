/**
 * Configuration Management
 *
 * Handles studio.config.js loading and creation
 */

export interface StudioConfig {
  tenantId: string;
  serviceKey: string;
  apiUrl: string;
  outputDir: string;
  apiMode: boolean;
}

/**
 * Get config file path (checks both .js and .ts)
 */
export async function getConfigPath(cwd?: string): Promise<string | null> {
  // Check if we're in Node.js environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    throw new Error('Config file operations are only supported in Node.js environment.');
  }

  // Dynamically import Node.js modules
  const { join } = await import('path');
  const { access } = await import('fs/promises');

  const workingDir = cwd || process.cwd();
  const jsPath = join(workingDir, 'studio.config.js');
  const tsPath = join(workingDir, 'studio.config.ts');

  try {
    await access(jsPath);
    return jsPath;
  } catch {
    try {
      await access(tsPath);
      return tsPath;
    } catch {
      return null;
    }
  }
}

/**
 * Check if config file exists
 */
export async function configExists(cwd?: string): Promise<boolean> {
  const path = await getConfigPath(cwd);
  return path !== null;
}

/**
 * Load configuration from studio.config.js or studio.config.ts
 */
export async function loadConfig(cwd?: string): Promise<StudioConfig | null> {
  // Check if we're in Node.js environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    throw new Error('Config file operations are only supported in Node.js environment.');
  }

  // Dynamically import Node.js modules
  const { pathToFileURL } = await import('url');

  const configPath = await getConfigPath(cwd);

  if (!configPath) {
    return null;
  }

  try {
    // Dynamic import for ESM config file
    const configUrl = pathToFileURL(configPath).href;
    const configModule = await import(configUrl);
    const config = configModule.default || configModule;

    // Validate required fields
    if (!config.tenantId || !config.serviceKey) {
      throw new Error('Config missing required fields: tenantId, serviceKey');
    }

    return {
      tenantId: config.tenantId,
      serviceKey: config.serviceKey,
      apiUrl: config.apiUrl || 'https://api.skej.com',
      outputDir: config.outputDir || './studio/prompts',
      apiMode: config.apiMode !== undefined ? config.apiMode : false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

/**
 * Create studio.config.js or studio.config.ts template
 */
export async function createConfig(options: {
  apiUrl: string;
  outputDir: string;
  typescript?: boolean;
  cwd?: string;
}): Promise<string> {
  // Check if we're in Node.js environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    throw new Error('Config file operations are only supported in Node.js environment.');
  }

  // Dynamically import Node.js modules
  const { join } = await import('path');
  const { writeFile } = await import('fs/promises');

  const { apiUrl, outputDir, typescript = false, cwd } = options;
  const workingDir = cwd || process.cwd();
  const extension = typescript ? 'ts' : 'js';
  const configPath = join(workingDir, `studio.config.${extension}`);

  const jsTemplate = `/**
 * Studio Configuration
 *
 * Get your service key from: ${apiUrl}/settings/service-keys
 *
 * WARNING: Keep this file out of version control!
 * Add studio.config.${extension} to your .gitignore
 */

export default {
  // Tenant ID - get from Studio dashboard
  tenantId: 'YOUR_TENANT_ID',

  // Service Key (sk-xxx) - get from Studio dashboard
  // IMPORTANT: Keep this secret! Do not commit to git.
  serviceKey: process.env.STUDIO_SERVICE_KEY || 'sk-xxx',

  // API URL
  apiUrl: '${apiUrl}',

  // Output directory for exported prompts
  outputDir: '${outputDir}',

  // API Mode - load prompts from API at runtime instead of local files
  // false: Use local exported files (faster, offline)
  // true: Load from API on every execution (always up-to-date)
  apiMode: false,
};
`;

  const tsTemplate = `/**
 * Studio Configuration
 *
 * Get your service key from: ${apiUrl}/settings/service-keys
 *
 * WARNING: Keep this file out of version control!
 * Add studio.config.${extension} to your .gitignore
 */

export interface StudioConfig {
  tenantId: string;
  serviceKey: string;
  apiUrl: string;
  outputDir: string;
  apiMode: boolean;
}

const config: StudioConfig = {
  // Tenant ID - get from Studio dashboard
  tenantId: 'YOUR_TENANT_ID',

  // Service Key (sk-xxx) - get from Studio dashboard
  // IMPORTANT: Keep this secret! Do not commit to git.
  serviceKey: process.env.STUDIO_SERVICE_KEY || 'sk-xxx',

  // API URL
  apiUrl: '${apiUrl}',

  // Output directory for exported prompts
  outputDir: '${outputDir}',

  // API Mode - load prompts from API at runtime instead of local files
  // false: Use local exported files (faster, offline)
  // true: Load from API on every execution (always up-to-date)
  apiMode: false,
};

export default config;
`;

  const template = typescript ? tsTemplate : jsTemplate;
  await writeFile(configPath, template, 'utf-8');

  return configPath;
}

/**
 * Resolve output directory path
 */
export async function resolveOutputDir(outputDir: string, cwd?: string): Promise<string> {
  // Check if we're in Node.js environment
  if (typeof process === 'undefined' || !process.versions || !process.versions.node) {
    throw new Error('Path operations are only supported in Node.js environment.');
  }

  // Dynamically import Node.js modules
  const { resolve } = await import('path');
  const workingDir = cwd || process.cwd();
  return resolve(workingDir, outputDir);
}
