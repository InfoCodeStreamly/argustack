import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'tests/mcp/**/*.test.ts',
    ],
    exclude: [
      'tests/architecture/**',
      'tests/unit/board/vite.config.test.ts',
    ],
  },
});
