import { defineConfig } from 'vitest/config';

// Pure local unit tests only: no deployed services, e2e, or integration suites.
export default defineConfig({
  test: {
    include: [
      'packages/worker/src/reader-settings.test.ts',
      'packages/worker/src/markdown.test.ts',
      'packages/mcp/src/book-template.test.ts',
      'packages/mcp/src/validate-publication.test.ts',
    ],
  },
});
