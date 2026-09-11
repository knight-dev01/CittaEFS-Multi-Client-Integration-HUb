import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/test/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/data/**', 'src/schemas/**', 'src/lib/**', 'src/adapters/**', 'src/services/**'],
      exclude: ['src/test/verifyAll.ts'],
    },
    testTimeout: 10000,
  },
});
