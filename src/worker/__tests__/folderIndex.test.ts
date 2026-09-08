/**
 * FolderIndex is the data structure the whole background-search feature
 * stands on: if its search or persistence round-trip is wrong, search
 * silently returns wrong results rather than failing loudly — the worst
 * failure mode for a "find things reliably" feature. These tests exercise
 * it directly, without needing a real PST.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { HeaderRow } from '../headerIndex'
import { FolderIndex } from '../folderIndex'

function row(partial: Partial<HeaderRow> & { id: string }): HeaderRow {
  return {
    subject: '',
    fromName: '',
    toDisplay: '',
    ccDisplay: '',
    date: null,
    ...partial,
  }
}

describe('FolderIndex — search', () => {
  test('matches across subject, sender, and recipients', () => {
    const idx = new FolderIndex('f1', 'Inbox', 3)
    idx.addRow(row({ id: '1', subject: 'Quarterly report', fromName: 'Alice' }))
    idx.addRow(row({ id: '2', subject: 'Lunch?', fromName: 'Bob', toDisplay: 'quarterly-team@x.com' }))
    idx.addRow(row({ id: '3', subject: 'Unrelated', fromName: 'Carol' }))

    const hits = idx.search('quarterly', 10)
    assert.deepEqual(new Set(hits), new Set([0, 1]))
  })

  test('is case-insensitive', () => {
    const idx = new FolderIndex('f1', 'Inbox', 1)
    idx.addRow(row({ id: '1', subject: 'URGENT: Server Down' }))
    assert.deepEqual(idx.search('urgent', 10), [0])
    assert.deepEqual(idx.search('SERVER', 10), [0])
  })

  test('does not match across adjacent rows', () => {
    // A naive "\n"-joined blob without row boundaries could match a query
    // that spans the end of one row's text and the start of the next.
    const idx = new FolderIndex('f1', 'Inbox', 2)
    idx.addRow(row({ id: '1', subject: 'ends with fo' }))
    idx.addRow(row({ id: '2', subject: 'ox starts here' }))
    assert.deepEqual(idx.search('foox', 10), [])
  })

  test('returns each matching row once even with multiple field hits', () => {
    const idx = new FolderIndex('f1', 'Inbox', 1)
    idx.addRow(row({ id: '1', subject: 'invoice', fromName: 'invoice@vendor.com', toDisplay: 'invoice-team' }))
    assert.deepEqual(idx.search('invoice', 10), [0])
  })

  test('respects the result limit', () => {
    const idx = new FolderIndex('f1', 'Inbox', 5)
    for (let i = 0; i < 5; i++) idx.addRow(row({ id: String(i), subject: 'match' }))
    assert.equal(idx.search('match', 2).length, 2)
  })

  test('empty query and empty index both return nothing', () => {
    const idx = new FolderIndex('f1', 'Inbox', 1)
    idx.addRow(row({ id: '1', subject: 'anything' }))
    assert.deepEqual(idx.search('', 10), [])
    assert.deepEqual(new FolderIndex('f2', 'Empty', 0).search('anything', 10), [])
  })

  test('reflects rows added after earlier searches (progressive indexing)', () => {
    const idx = new FolderIndex('f1', 'Inbox', 2)
    idx.addRow(row({ id: '1', subject: 'first' }))
    assert.deepEqual(idx.search('second', 10), [])
    idx.addRow(row({ id: '2', subject: 'second' }))
    assert.deepEqual(idx.search('second', 10), [1])
  })

  test('indexedCount and complete track partial progress', () => {
    const idx = new FolderIndex('f1', 'Inbox', 2)
    assert.equal(idx.indexedCount, 0)
    assert.equal(idx.complete, false)
    idx.addRow(row({ id: '1' }))
    assert.equal(idx.indexedCount, 1)
    assert.equal(idx.complete, false)
    idx.addRow(row({ id: '2' }))
    assert.equal(idx.complete, true)
  })
})

describe('FolderIndex — persistence round-trip', () => {
  test('rehydrates to identical search behavior', () => {
    const idx = new FolderIndex('f1', 'Inbox', 3)
    idx.addRow(row({ id: '1', subject: 'Alpha', fromName: 'a@x.com', date: '2024-01-01T00:00:00.000Z' }))
    idx.addRow(row({ id: '2', subject: 'Beta', toDisplay: 'beta-list' }))
    idx.addRow(row({ id: '3', subject: 'Gamma' }))

    const restored = FolderIndex.fromPersisted(idx.toPersisted())

    assert.deepEqual(restored.ids, idx.ids)
    assert.deepEqual(restored.subjects, idx.subjects)
    assert.deepEqual(restored.fromNames, idx.fromNames)
    assert.deepEqual(restored.dates, idx.dates)
    assert.deepEqual(restored.search('beta', 10), idx.search('beta', 10))
    assert.deepEqual(restored.search('alpha', 10), [0])
  })
})
