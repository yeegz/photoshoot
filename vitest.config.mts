import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright specs live in test/browser and run via
// `npm run test:e2e`; the older Node scripts in build/ run via `npm run test:node`.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});
