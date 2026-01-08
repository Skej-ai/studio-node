/**
 * Init Command
 *
 * Initialize studio.config.js in the current directory
 */

import { createConfig, configExists, getConfigPath } from '../utils/config.js';

interface InitOptions {
  apiUrl: string;
  outputDir: string;
  typescript?: boolean;
}

/**
 * Initialize studio.config.js or studio.config.ts
 */
export async function initCommand(options: InitOptions): Promise<void> {
  try {
    // Check if config already exists
    if (await configExists()) {
      const existingPath = await getConfigPath();
      console.error(`❌ Config file already exists`);
      console.error(`   Location: ${existingPath}`);
      process.exit(1);
    }

    // Create config file
    const configPath = await createConfig({
      apiUrl: options.apiUrl,
      outputDir: options.outputDir,
      typescript: options.typescript,
    });

    const extension = options.typescript ? 'ts' : 'js';
    console.log(`✅ Created studio.config.${extension}`);
    console.log(`   Location: ${configPath}`);
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Get your tenant ID from Studio dashboard');
    console.log('   2. Create a service key at: Settings → Service Keys');
    console.log(`   3. Update studio.config.${extension} with your credentials`);
    console.log(`   4. Add studio.config.${extension} to .gitignore`);
    console.log('   5. Run: skej export');
  } catch (error) {
    console.error('❌ Failed to create config:', (error as Error).message);
    process.exit(1);
  }
}
