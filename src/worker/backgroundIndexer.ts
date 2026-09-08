/// <reference lib="webworker" />
/**
 * Runs after a file opens: walks every folder's contents table in the
 * background, building a searchable header index (see folderIndex.ts and
 * headerIndex.ts) without blocking — or meaningfully slowing — anything
 * the user actually asked for.
 *
 * Two things make that true:
 *
 *  1. Adaptive time-slicing. Each slice decodes rows until roughly
 *     `TARGET_SLICE_MS` has elapsed, then hands control back to the event
 *     loop via `setTimeout(fn, 0)` before scheduling the next slice. A
 *     message the main thread sent while a slice was running — "list this
 *     folder", "open this message" — is already sitting in the event
 *     queue by the time that timeout fires, so it runs first. The worker
 *     never does more than one slice's worth of uninterruptible work
 *     (tens of milliseconds), so real requests never wait long, and the
 *     slice size self-tunes to whatever the device can actually do:
 *     a fast machine indexes thousands of rows per slice, a slow one
 *     indexes hundreds — both stay responsive without being told which
 *     kind of machine they are.
 *
 *  2. A hard cap on total indexed rows (`MAX_INDEXED_ROWS`). Indexing more
 *     stops adding memory pressure rather than growing without bound on
 *     an archive large enough to matter — the goal this exists for is
 *     specifically *not* overwhelming an 8 GB machine on a 50 GB file.
 *     Hitting the cap is reported, not hidden: the UI says plainly that
 *     search covers what got indexed and nothing past it.
 */
import type { PSTFile } from 'pst-extractor'
import type { FolderNode, IndexProgress, IndexState, SearchHit } from '../types'
import { type FolderTable, assertHeaderIndexViable, openFolderTable, readHeaderRows } from './headerIndex'
import { FolderIndex } from './folderIndex'
import { clearFingerprint, computeFingerprint, loadFolderIndex, saveFolderIndex } from './indexStore'

const TARGET_SLICE_MS = 8
const MIN_ROWS_PER_SLICE = 20
const MAX_ROWS_PER_SLICE = 20_000
// ~165 bytes/row measured (blob + offsets + id/subject/from/date arrays),
// so this caps the index at roughly 330 MB — a deliberate ceiling on an
// 8 GB machine, not an arbitrary one.
const MAX_INDEXED_ROWS = 2_000_000

type ProgressListener = (progress: IndexProgress) => void

export class BackgroundIndexer {
  private pstFile: PSTFile
  private folderById: Map<string, import('pst-extractor').PSTFolder>
  private fingerprint: string

  private queue: FolderNode[] = []
  private byFolderId = new Map<string, FolderIndex>()

  private current: { node: FolderNode; table: FolderTable; offset: number; index: FolderIndex } | null =
    null

  private rowsPerSlice = 300
  private totalIndexed = 0
  private totalMessages = 0
  private foldersTotal = 0
  private foldersDone = 0

  private paused = false
  private stopped = false
  private capped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastReportAt = 0
  private listener: ProgressListener | null = null

  constructor(
    pstFile: PSTFile,
    folderById: Map<string, import('pst-extractor').PSTFolder>,
    root: FolderNode,
    fileSize: number,
    lastModified: number
  ) {
    this.pstFile = pstFile
    this.folderById = folderById
    this.fingerprint = computeFingerprint(fileSize, lastModified)

    const folders: FolderNode[] = []
    const collect = (node: FolderNode) => {
      if (node.totalCount > 0) folders.push(node)
      node.children.forEach(collect)
    }
    collect(root)
    this.queue = folders
    this.foldersTotal = folders.length
    this.totalMessages = folders.reduce((sum, f) => sum + f.totalCount, 0)
  }

  onProgress(listener: ProgressListener): void {
    this.listener = listener
  }

  start(): void {
    this.scheduleNext()
  }

  pause(): void {
    this.paused = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.report()
  }

  resume(): void {
    if (!this.paused || this.stopped) return
    this.paused = false
    this.scheduleNext()
  }

  /** Stops scheduling further work but keeps whatever was already indexed
   * — a deliberate choice over discarding it: partial coverage that says
   * so honestly is still useful. */
  stop(): void {
    this.stopped = true
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.report()
  }

  async clearCache(): Promise<void> {
    await clearFingerprint(this.fingerprint)
  }

  search(query: string, limit: number): SearchHit[] {
    // FolderIndex.search() lowercases internally too; trimming here is the
    // one thing it doesn't do, so it's worth keeping this pass rather than
    // relying entirely on the callee.
    const q = query.trim()
    if (!q) return []
    const hits: SearchHit[] = []
    for (const index of this.byFolderId.values()) {
      if (hits.length >= limit) break
      const rows = index.search(q, limit - hits.length)
      for (const row of rows) {
        hits.push({
          folderId: index.folderId,
          folderName: index.folderName,
          messageId: index.ids[row],
          subject: index.subjects[row],
          fromName: index.fromNames[row],
          date: index.dates[row],
        })
      }
    }
    return hits
  }

  private snapshot(state: IndexState): IndexProgress {
    return {
      totalMessages: this.totalMessages,
      indexedMessages: this.totalIndexed,
      foldersTotal: this.foldersTotal,
      foldersDone: this.foldersDone,
      currentFolderName: this.current?.node.name ?? null,
      state,
    }
  }

  private report(force = false): void {
    if (!this.listener) return
    const now = performance.now()
    if (!force && now - this.lastReportAt < 250) return
    this.lastReportAt = now
    const state: IndexState = this.stopped
      ? 'stopped'
      : this.capped
        ? 'capped'
        : this.paused
          ? 'paused'
          : this.isDone()
            ? 'done'
            : 'running'
    this.listener(this.snapshot(state))
  }

  private isDone(): boolean {
    return !this.current && this.queue.length === 0
  }

  private scheduleNext(): void {
    if (this.paused || this.stopped) return
    this.timer = setTimeout(() => void this.runSlice(), 0)
  }

  /** Advances to the next folder that actually needs live indexing,
   * loading any already-cached folder from IndexedDB near-instantly
   * instead of re-reading the PST for it. Returns false once there is
   * nothing left to do anywhere. */
  private async ensureCurrentFolder(): Promise<boolean> {
    while (!this.current && this.queue.length > 0) {
      const node = this.queue.shift()!

      const cached = await loadFolderIndex(this.fingerprint, node.id)
      if (cached && cached.total === node.totalCount) {
        const index = FolderIndex.fromPersisted(cached)
        this.byFolderId.set(node.id, index)
        this.totalIndexed += index.indexedCount
        this.foldersDone++
        continue
      }

      const folder = this.folderById.get(node.id)
      if (!folder) {
        this.foldersDone++
        continue
      }

      try {
        const table = openFolderTable(this.pstFile, folder)
        assertHeaderIndexViable(table)
        const index = new FolderIndex(node.id, node.name, table.rowCount)
        this.byFolderId.set(node.id, index)
        this.current = { node, table, offset: 0, index }
      } catch (err) {
        // One malformed folder shouldn't stop the rest of the archive from
        // being searchable.
        console.error('Skipping folder from background index:', node.name, err)
        this.foldersDone++
        continue
      }
    }
    return this.current !== null
  }

  private async runSlice(): Promise<void> {
    if (this.paused || this.stopped) return

    if (this.totalIndexed >= MAX_INDEXED_ROWS) {
      this.capped = true
      this.report(true)
      return
    }

    const started = performance.now()
    const hasWork = await this.ensureCurrentFolder()
    if (!hasWork) {
      this.report(true)
      return
    }

    const cur = this.current!
    const budget = Math.min(this.rowsPerSlice, MAX_INDEXED_ROWS - this.totalIndexed)
    const rows = readHeaderRows(cur.table, cur.offset, budget)
    for (const row of rows) cur.index.addRow(row)
    cur.offset += rows.length
    this.totalIndexed += rows.length

    if (cur.offset >= cur.table.rowCount || rows.length === 0) {
      this.foldersDone++
      // Fire-and-forget: a failed write just means no cache benefit next
      // time, not a reason to stall live indexing.
      void saveFolderIndex(this.fingerprint, cur.index.toPersisted())
      this.current = null
    }

    const elapsed = performance.now() - started
    if (elapsed > 0 && rows.length > 0) {
      const rowsPerMs = rows.length / elapsed
      this.rowsPerSlice = Math.max(
        MIN_ROWS_PER_SLICE,
        Math.min(MAX_ROWS_PER_SLICE, Math.round(rowsPerMs * TARGET_SLICE_MS))
      )
    }

    this.report()

    if (this.totalIndexed >= MAX_INDEXED_ROWS && (this.current || this.queue.length > 0)) {
      this.capped = true
      this.report(true)
      return
    }

    if (this.current || this.queue.length > 0) {
      this.scheduleNext()
    } else {
      this.report(true)
    }
  }
}
