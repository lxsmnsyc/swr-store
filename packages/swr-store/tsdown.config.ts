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
  dts: true,
  exports: true,
});
