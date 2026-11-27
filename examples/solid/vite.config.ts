import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  resolve: {
    // swr-store's workspace copy installs Solid 2.0 for its own tests. This
    // example runs on Solid 1.x, so every `solid-js` import resolves here.
    dedupe: ['solid-js'],
  },
});
