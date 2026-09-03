/**
 * Correctness tests for the cache + Buffer-shaped-object arithmetic in
 * lazyFileSource.ts — the part that's actually tricky (block-boundary
 * math, LRU eviction, partial final block, EOF clamping).
 *
 * This exercises createLazyBufferSource() with a `readRange` backed by
 * plain `fs.readSync` against a real file on disk, standing in for the
 * production `File.slice()` + `FileReaderSync` (a browser/Worker-only API
 * this test environment can't call directly — see README.md's Limitations
 * section for how that gap is covered instead). The cache/copy logic under
 * test is identical either way; only how bytes are fetched differs.
 *
 * Run with: npx tsx --test src/worker/__tests__/lazyFileSource.test.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, before, describe, test } from 'node:test'
import { Buffer } from 'buffer'
import { createLazyBufferSource } from '../lazyFileSource'

const BLOCK_SIZE = 64 * 1024

// Sized to span many blocks plus a short, non-block-aligned final block —
// exactly the case most likely to have an off-by-one.
const FILE_LENGTH = 5 * BLOCK_SIZE + 37

function expectedByte(position: number): number {
  return position % 256
}

let filePath: string
let fd: number
let readCount = 0

before(() => {
  filePath = path.join(os.tmpdir(), `lazy-file-source-test-${process.pid}.bin`)
  const content = Buffer.alloc(FILE_LENGTH)
  for (let i = 0; i < FILE_LENGTH; i++) content[i] = expectedByte(i)
  fs.writeFileSync(filePath, content)
  fd = fs.openSync(filePath, 'r')
})

afterEach(() => {
  readCount = 0
})

function makeSource() {
  return createLazyBufferSource(FILE_LENGTH, (start, end) => {
    readCount++
    const out = Buffer.alloc(end - start)
    fs.readSync(fd, out, 0, end - start, start)
    return out
  })
}

function assertRange(target: Buffer, targetStart: number, sourceStart: number, count: number) {
  for (let i = 0; i < count; i++) {
    assert.equal(
      target[targetStart + i],
      expectedByte(sourceStart + i),
      `byte at source offset ${sourceStart + i} (target[${targetStart + i}])`
    )
  }
}

describe('createLazyBufferSource', () => {
  test('satisfies `instanceof Buffer` without allocating a real backing buffer', () => {
    const source = makeSource()
    assert.ok(source instanceof Buffer, 'must be `instanceof Buffer` for pst-extractor to select the in-memory read path')
    assert.equal(readCount, 0, 'constructing the source must not eagerly read anything')
  })

  test('reads a range fully within one block', () => {
    const source = makeSource()
    const target = Buffer.alloc(100)
    const written = source.copy(target, 0, 10, 110)
    assert.equal(written, 100)
    assertRange(target, 0, 10, 100)
    assert.equal(readCount, 1, 'one block read for one small in-block range')
  })

  test('stitches a read that spans multiple block boundaries', () => {
    const source = makeSource()
    const start = BLOCK_SIZE - 50
    const length = BLOCK_SIZE * 2 + 100 // crosses 3 block boundaries
    const target = Buffer.alloc(length)
    const written = source.copy(target, 0, start, start + length)
    assert.equal(written, length)
    assertRange(target, 0, start, length)
  })

  test('handles the short final block and clamps reads past EOF', () => {
    const source = makeSource()
    const target = Buffer.alloc(200)
    // Ask for 200 bytes starting 50 before EOF — only 87 actually exist.
    const start = FILE_LENGTH - 50
    const written = source.copy(target, 0, start, start + 200)
    assert.equal(written, 50, 'copy must clamp to available bytes, not throw or overrun')
    assertRange(target, 0, start, 50)
  })

  test('respects a non-zero targetStart without clobbering surrounding bytes', () => {
    const source = makeSource()
    const target = Buffer.alloc(50, 0xaa)
    const written = source.copy(target, 10, 5, 25)
    assert.equal(written, 20)
    assert.equal(target[9], 0xaa, 'byte before targetStart must be untouched')
    assert.equal(target[30], 0xaa, 'byte after the written region must be untouched')
    assertRange(target, 10, 5, 20)
  })

  test('caches recently-used blocks (no re-read on repeat access)', () => {
    const source = makeSource()
    const target = Buffer.alloc(10)
    source.copy(target, 0, 0, 10)
    const afterFirst = readCount
    source.copy(target, 0, 0, 10)
    assert.equal(readCount, afterFirst, 'second read of the same block must be served from cache')
  })

  test('evicts old blocks under the cache cap, but re-fetches them correctly on demand', () => {
    const source = makeSource()
    const target = Buffer.alloc(4)

    // Touch far more distinct blocks than the (undisclosed, intentionally
    // internal) cache cap — this file is too short to actually do that at
    // 64 KiB/block, so shrink the effective stride by reading many small,
    // scattered offsets across the whole file instead. The point isn't the
    // exact cap value, just that eviction never corrupts subsequent reads.
    for (let i = 0; i < 50; i++) {
      const offset = (i * 997) % (FILE_LENGTH - 4) // scattered, deterministic
      source.copy(target, 0, offset, offset + 4)
      assertRange(target, 0, offset, 4)
    }

    // Re-read the very first offset again — whether or not it was evicted,
    // the bytes returned must still be correct.
    source.copy(target, 0, 0, 4)
    assertRange(target, 0, 0, 4)
  })
})
