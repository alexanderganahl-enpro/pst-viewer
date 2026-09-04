import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// pst-extractor (and iconv-lite underneath it) were written for Node. We
// only ever use the in-memory `Buffer` constructor path, never the
// filesystem path, so these polyfills just need to make `Buffer` and a
// stubbed `fs` module resolve — plus a real, pako-backed `zlib`, since
// pst-extractor auto-detects zlib-compressed blocks in some PST variants.
// Much of that code (pst-extractor itself included) references `Buffer` as
// an ambient global rather than importing it, so the `globals: { Buffer:
// true }` injection below is load-bearing, not just belt-and-braces.
const pstPolyfills = () =>
  nodePolyfills({
    include: ['buffer', 'fs', 'path', 'stream', 'util', 'zlib'],
    globals: {
      Buffer: true,
      global: true,
      process: true,
    },
  })

// https://vite.dev/config/
export default defineConfig({
  // Served from https://<user>.github.io/pst-viewer/
  base: '/pst-viewer/',
  plugins: [pstPolyfills(), react()],
  worker: {
    // All the PST-parsing code (and its need for these polyfills) lives in
    // the Web Worker (src/worker/pstWorker.ts). Vite builds a worker
    // bundled with `new Worker(new URL(...))` as a genuinely separate
    // Rollup build — plugins in the top-level `plugins` array above do NOT
    // automatically apply to it, so the global injection has to be
    // supplied again here. Confirmed the hard way: without this, the
    // worker bundle contains pst-extractor's bare `Buffer.alloc(...)`
    // calls with no `Buffer` binding in scope anywhere — a
    // `ReferenceError: Buffer is not defined` the moment any PST is
    // opened, in every browser, on every file.
    plugins: () => [pstPolyfills()],
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
})
