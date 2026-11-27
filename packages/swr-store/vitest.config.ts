import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vitest/config';

// `solid-js` ships a server build that the `node` condition picks up, and
// the server build never runs effects. The Solid suites resolve the browser
// build instead so that subscriptions are exercised. The `development`
// condition turns on Solid's dev checks, such as writes from a component body.
const SOLID_CONDITIONS = ['browser', 'development', 'import', 'module', 'default'];

// The `swr-store/solid` binding targets Solid 1.x. The package installs 1.x
// as `solid-js-1`, next to 2.0 as `solid-js`, and its suites read 1.x.
const SOLID_1_ALIAS = [{ find: /^solid-js(?=\/|$)/, replacement: 'solid-js-1' }];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          environment: 'jsdom',
          include: ['test/core/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'model',
          environment: 'jsdom',
          include: ['test/model/**/*.test.ts'],
        },
      },
      {
        // No DOM, so the store behaves as it does during SSR.
        test: {
          name: 'server',
          environment: 'node',
          include: ['test/server/**/*.test.ts'],
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
        resolve: { alias: SOLID_1_ALIAS, conditions: SOLID_CONDITIONS },
        ssr: { resolve: { conditions: SOLID_CONDITIONS } },
        test: {
          name: 'solid',
          environment: 'jsdom',
          include: ['test/solid/**/*.test.ts'],
          exclude: ['test/solid/server.test.ts'],
        },
      },
      {
        resolve: { alias: SOLID_1_ALIAS },
        test: {
          name: 'solid-server',
          environment: 'node',
          include: ['test/solid/server.test.ts'],
        },
      },
      {
        // Under test the plugin compiles non-hydratable client code, and the
        // hydration tests need hydratable code.
        plugins: [solid({ ssr: true, solid: { hydratable: true } })],
        resolve: { conditions: SOLID_CONDITIONS },
        ssr: { resolve: { conditions: SOLID_CONDITIONS } },
        test: {
          name: 'solid2',
          environment: 'jsdom',
          include: ['test/solid2/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [solid({ ssr: true })],
        test: {
          name: 'solid2-server',
          environment: 'node',
          include: ['test/solid2-server/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
