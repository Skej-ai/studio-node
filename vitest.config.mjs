import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/types.ts',
        'src/providers/bedrock.ts',
        'src/providers/deepseek.ts',
        'src/index.ts',
        'node_modules/**',
        'dist/**'
      ],
      thresholds: {
        lines: 70,
        functions: 75,
        branches: 70,
        statements: 70
      }
    }
  }
});
