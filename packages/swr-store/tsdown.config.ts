import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    preact: 'src/preact/index.ts',
    react: 'src/react/index.ts',
    solid: 'src/solid/index.ts',
  },
  format: ['esm', 'cjs'],
  platform: 'neutral',
  // Matches the TypeScript target. Without it, tsdown picks a target from
  // `engines.node` and keeps newer syntax such as `??` in the output.
  target: 'es2020',
  dts: true,
  exports: true,
});
