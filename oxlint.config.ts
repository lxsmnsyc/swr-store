import config from '@lxsmnsyc/oxlint-config';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [config],
  ignorePatterns: ['**/dist/**', '**/node_modules/**'],
  overrides: [
    {
      // The public store types take their argument tuples as `any[]`. Moving
      // them to `unknown[]` would reject callbacks with typed parameters, such
      // as `get: (id: string) => ...`, so the source keeps `any` there.
      files: ['packages/*/src/**'],
      rules: {
        'typescript/no-explicit-any': 'off',
      },
    },
    {
      files: [
        'packages/*/src/react/**',
        'packages/*/src/preact/**',
        'examples/react/**',
        'examples/preact/**',
      ],
      plugins: ['react'],
      rules: {
        'react/rules-of-hooks': 'error',
      },
    },
    {
      // Store fetchers in tests are `async` without awaiting anything, since
      // stores only accept functions that return a promise. Listeners are
      // `vi.fn()` mocks, which return a value, and the deprecated root is
      // tested on purpose.
      files: ['packages/*/test/**'],
      rules: {
        'typescript/explicit-function-return-type': 'off',
        'typescript/explicit-module-boundary-types': 'off',
        'typescript/no-deprecated': 'off',
        'typescript/require-await': 'off',
        'typescript/strict-void-return': 'off',
      },
    },
    {
      // The examples read a JSON response, which the DOM lib types as `any`,
      // and narrow it to the API shape with an assertion.
      files: ['examples/**'],
      rules: {
        'typescript/no-unsafe-type-assertion': 'off',
        'import/prefer-default-export': 'off',
        'no-console': 'off',
        'typescript/explicit-function-return-type': 'off',
        'typescript/explicit-module-boundary-types': 'off',
      },
    },
  ],
});
