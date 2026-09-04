/// <reference lib="webworker" />
import { Buffer } from 'buffer'

const BLOCK_SIZE = 64 * 1024 // 64 KiB aligned read granularity
const MAX_CACHED_BLOCKS = 512 // 512 * 64 KiB = 32 MiB cache cap

export type ByteRangeReader = (start: number, end: number) => Uint8Array

/**
 * The cache + `Buffer`-shaped-object logic, kept separate from *how* bytes
 * are actually fetched (`readRange`) so it can be unit tested in Node
 * against a real file via `fs.readSync`, without needing a browser's
 * `FileReaderSync` (see src/worker/__tests__/lazyFileSource.test.ts).
 *
 * Verified against pst-extractor@1.12.0's compiled output: `PSTFile`'s
 * in-memory read path is exactly one call site —
 * `this.pstBuffer.copy(buffer, 0, position, position + length)` inside
 * `readSync` — and nothing else in the library touches `pstBuffer`. So the
 * only method that has to behave correctly here is `.copy()`.
 *
 * `Object.create(Buffer.prototype)` gives the returned object a prototype
 * chain that satisfies pst-extractor's `arg instanceof Buffer` check in its
 * constructor (which is how it decides to use the in-memory path instead
 * of treating `arg` as a filename) — *without* allocating a real backing
 * `Uint8Array`/`ArrayBuffer` the size of the whole file, the way actually
 * constructing a `Buffer` that large would. It's a plain object wearing
 * Buffer's prototype for `instanceof` purposes only; we set our own
 * `.copy` directly on the object (an "own" property), which shadows the
 * real `Buffer.prototype.copy` so it's never reached — that real one would
 * throw or misbehave on a receiver with no actual typed-array backing.
 */
export interface LazySource {
  /** The `Buffer`-shaped object to hand to `new PSTFile(...)`. */
  source: Buffer
  /**
   * Throws unless pst-extractor actually read through our shim.
   *
   * Everything here rests on one undocumented assumption: that
   * `PSTFile.readSync` reaches the file via `this.pstBuffer.copy(...)`. If a
   * future version changes that, the sentinel silently stops being
   * consulted and we'd serve whatever its (empty) internals contain —
   * wrong data rather than a crash. Call this right after constructing
   * PSTFile, which always reads the 514-byte header, so "never called"
   * unambiguously means the assumption broke.
   */
  assertWasUsed(): void
}

export function createLazyBufferSource(length: number, readRange: ByteRangeReader): Buffer {
  // Insertion-order Map doubles as an LRU: touching a key re-inserts it at
  // the end, and the least-recently-used entry is whatever key iteration
  // yields first.
  const cache = new Map<number, Uint8Array>()

  function readBlock(blockIndex: number): Uint8Array {
    const cached = cache.get(blockIndex)
    if (cached) {
      cache.delete(blockIndex)
      cache.set(blockIndex, cached)
      return cached
    }
    const start = blockIndex * BLOCK_SIZE
    const end = Math.min(start + BLOCK_SIZE, length)
    const bytes = readRange(start, end)
    cache.set(blockIndex, bytes)
    if (cache.size > MAX_CACHED_BLOCKS) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return bytes
  }

  function copy(
    target: Buffer,
    targetStart = 0,
    sourceStart = 0,
    sourceEnd = length
  ): number {
    // Buffer.prototype.copy silently clamps to available source bytes
    // rather than throwing — match that (readSync ignores this return
    // value and always reports the full requested length anyway, exactly
    // as it does for a real, fully in-memory Buffer).
    const clampedEnd = Math.min(sourceEnd, length)
    let pos = sourceStart
    let written = 0
    while (pos < clampedEnd) {
      const blockIndex = Math.floor(pos / BLOCK_SIZE)
      const block = readBlock(blockIndex)
      const offsetInBlock = pos - blockIndex * BLOCK_SIZE
      const bytesToCopy = Math.min(block.length - offsetInBlock, clampedEnd - pos)
      if (bytesToCopy <= 0) break // guards against a short final block
      target.set(
        block.subarray(offsetInBlock, offsetInBlock + bytesToCopy),
        targetStart + written
      )
      written += bytesToCopy
      pos += bytesToCopy
    }
    return written
  }

  // `any` is deliberate and unavoidable: this object is intentionally *not*
  // a real Buffer, it just wears Buffer's prototype so pst-extractor's
  // `instanceof` check passes. Typing it as Buffer would be a lie that
  // hides the very trick this file exists to document.
  const sentinel: any = Object.create(Buffer.prototype)
  // `length` is a getter-only accessor inherited from Uint8Array.prototype
  // — a plain `sentinel.length = length` assignment throws ("Cannot set
  // property length of [object Object] which has only a getter") because
  // there's no inherited setter to run. defineProperty sidesteps the
  // setter chain entirely by creating a new own data property, which is
  // allowed to shadow an inherited accessor. (pst-extractor never actually
  // reads `.length` on this object — verified by grep — this is just
  // defensive, in case a future version starts to.)
  Object.defineProperty(sentinel, 'length', { value: length, enumerable: true })
  sentinel.copy = copy
  return sentinel as Buffer
}

/** Production wiring: reads go through `File.slice()` + the in-worker-only
 * `FileReaderSync`, so only the byte ranges pst-extractor actually asks
 * for are ever read off disk — never the whole file. */
export function createLazyFileSource(file: File, length: number): LazySource {
  const reader = new FileReaderSync()
  let reads = 0

  const source = createLazyBufferSource(length, (start, end) => {
    reads++
    try {
      return new Uint8Array(reader.readAsArrayBuffer(file.slice(start, end)))
    } catch (err) {
      // Unlike eager mode, lazy mode keeps reading from disk for the whole
      // session, so the file can go away underneath us — moved, deleted, or
      // edited after being picked. The browser throws NotReadableError;
      // translate it into something a person can act on.
      throw new Error(
        `Could not read from "${file.name}" — the file may have been moved, ` +
          `deleted, or modified since it was opened. Please open it again. ` +
          `(${err instanceof Error ? err.message : String(err)})`
      )
    }
  })

  return {
    source,
    assertWasUsed() {
      if (reads > 0) return
      throw new Error(
        'Internal error: the on-demand file reader was never used, which means ' +
          'pst-extractor no longer reads through the path this app substitutes ' +
          'itself into. Refusing to continue rather than risk returning ' +
          'incorrect data. (Pin pst-extractor to a known-good version.)'
      )
    },
  }
}
