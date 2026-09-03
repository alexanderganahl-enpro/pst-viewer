import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://<user>.github.io/pst-viewer/
  base: '/pst-viewer/',
  plugins: [
    // pst-extractor (and iconv-lite underneath it) were written for Node.
    // We only ever use the in-memory `Buffer` constructor path, never the
    // filesystem path, so these polyfills just need to make `Buffer` and a
    // stubbed `fs` module resolve in the browser bundle.
    nodePolyfills({
      // pst-extractor auto-detects zlib-compressed blocks in some PST
      // variants, so zlib needs a real (pako-backed) implementation here,
      // not just a stub.
      include: ['buffer', 'fs', 'path', 'stream', 'util', 'zlib'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    react(),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
  },
})
