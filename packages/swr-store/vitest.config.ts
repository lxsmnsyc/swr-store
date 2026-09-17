import { defineConfig } from 'vitest/config';

// `solid-js` ships a server build that the `node` condition picks up, and
// the server build never runs effects. The Solid suite resolves the browser
// build instead so that subscriptions are exercised.
const SOLID_CONDITIONS = ['browser', 'development', 'import', 'module', 'default'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          environment: 'node',
          include: ['test/core/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['test/react/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'preact',
          environment: 'jsdom',
          include: ['test/preact/**/*.test.ts'],
        },
      },
      {
        resolve: { conditions: SOLID_CONDITIONS },
        ssr: { resolve: { conditions: SOLID_CONDITIONS } },
        test: {
          name: 'solid',
          environment: 'jsdom',
          include: ['test/solid/**/*.test.ts'],
        },
      },
    ],
  },
});
