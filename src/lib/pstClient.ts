import type {
  AttachmentMeta,
  FolderNode,
  IndexControlAction,
  IndexProgress,
  MessageDetail,
  MessageSummary,
  SearchHit,
  WorkerRequest,
  WorkerResponse,
} from '../types'
import { LAZY_MODE_THRESHOLD_BYTES } from '../types'

// Distributive Omit: applying Omit<T, K> directly to a discriminated union
// collapses it to the shared-key intersection. This preserves each variant.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never
type WorkerRequestNoId = DistributiveOmit<WorkerRequest, 'reqId'>

/** Thrown when a request is abandoned because the client was disposed —
 * expected during teardown, so callers can ignore it rather than surfacing
 * it as a failure. */
export class PstCancelledError extends Error {
  constructor() {
    super('Request cancelled')
    this.name = 'PstCancelledError'
  }
}

/**
 * Per-request-kind deadlines.
 *
 * These are generous, because the legitimate work varies by orders of
 * magnitude: opening a multi-GB archive or listing a folder with 100k
 * messages really can take minutes. The point isn't to police slowness,
 * it's that the worker does its parsing synchronously — so a pathological
 * input that sends it into a spin (exactly the class of bug that
 * `readCompletely` had) would otherwise leave a spinner up forever with no
 * way back. A blown deadline means the worker is wedged and unrecoverable,
 * so we tear it down rather than pretend it might still answer.
 */
const TIMEOUTS_MS: Record<string, number> = {
  open: 15 * 60_000,
  listFolder: 10 * 60_000,
  getMessage: 2 * 60_000,
  getAttachment: 5 * 60_000,
  // A search only ever scans what's already been decoded into memory —
  // there is no PST-format read on this path at all — so this is really
  // just a "the worker thread is wedged" tripwire, not a concession to
  // legitimately slow work.
  searchArchive: 30_000,
  indexControl: 30_000,
}

interface PendingEntry {
  resolve: (value: never) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Promise-based wrapper around the PST parsing worker. One instance is
 * created per opened file; call dispose() when done with it. */
export class PstClient {
  private worker: Worker
  private nextReqId = 1
  private pending = new Map<number, PendingEntry>()
  /** Set once the worker is gone (disposed, crashed, or timed out); every
   * later call fails fast instead of hanging on a thread that will never
   * answer. */
  private deadReason: string | null = null
  private indexProgressListener: ((progress: IndexProgress) => void) | null = null

  constructor() {
    this.worker = new Worker(new URL('../worker/pstWorker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const res = event.data

      // Pushed unprompted by the background indexer — not a reply to any
      // particular request, so it never has a matching reqId to route by.
      if (res.kind === 'indexProgress') {
        this.indexProgressListener?.(res.progress)
        return
      }

      const entry = this.pending.get(res.reqId)
      if (!entry) return
      this.pending.delete(res.reqId)
      clearTimeout(entry.timer)
      if (res.kind === 'error') {
        entry.reject(new Error(res.message))
      } else {
        entry.resolve(res as never)
      }
    }
    this.worker.onerror = (event) => {
      this.failAll(new Error(event.message || 'PST worker crashed'))
    }
  }

  /** Subscribes to background-indexing progress. One listener at a time —
   * App.tsx registers exactly one, matching the one PstClient per opened
   * file. */
  onIndexProgress(listener: (progress: IndexProgress) => void): void {
    this.indexProgressListener = listener
  }

  /** Rejects every in-flight request. Without this, a teardown would leave
   * callers awaiting a promise that can never settle — a stuck spinner and
   * a leaked async frame apiece. */
  private failAll(error: Error) {
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const entry of entries) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
  }

  private call<T extends WorkerResponse>(
    req: WorkerRequestNoId,
    transfer?: Transferable[]
  ): Promise<T> {
    if (this.deadReason) return Promise.reject(new Error(this.deadReason))

    const reqId = this.nextReqId++
    return new Promise<T>((resolve, reject) => {
      const timeoutMs = TIMEOUTS_MS[req.kind] ?? 5 * 60_000
      const timer = setTimeout(() => {
        this.deadReason =
          `The PST reader stopped responding while handling "${req.kind}" ` +
          `(no result after ${Math.round(timeoutMs / 60_000)} minutes). ` +
          `This usually means the file has a structure it can't parse. ` +
          `Please reopen the file to try again.`
        const reason = this.deadReason
        this.worker.terminate()
        this.failAll(new Error(reason))
      }, timeoutMs)

      this.pending.set(reqId, {
        resolve: resolve as (value: never) => void,
        reject,
        timer,
      })
      this.worker.postMessage({ ...req, reqId } as WorkerRequest, transfer ?? [])
    })
  }

  async open(
    file: File
  ): Promise<{ storeName: string; tree: FolderNode }> {
    let res: Extract<WorkerResponse, { kind: 'opened' }>

    if (file.size >= LAZY_MODE_THRESHOLD_BYTES) {
      // Large file: hand the File itself to the worker rather than reading
      // it here. Structured-cloning a File is cheap — the clone shares the
      // same underlying disk-backed data, it doesn't copy file contents —
      // so the worker can read byte ranges on demand and the full file is
      // never resident in memory at once. See lazyFileSource.ts.
      res = await this.call<Extract<WorkerResponse, { kind: 'opened' }>>({
        kind: 'open',
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
        source: { mode: 'lazy', file },
      })
    } else {
      const buffer = await file.arrayBuffer()
      // Transfer (not clone) the buffer into the worker — for a file near
      // the threshold this is the difference between one copy in memory
      // and two at the exact moment memory pressure is highest. `buffer`
      // is detached on the main thread after this call, which is fine:
      // nothing here reads it again.
      res = await this.call<Extract<WorkerResponse, { kind: 'opened' }>>(
        {
          kind: 'open',
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          source: { mode: 'eager', buffer },
        },
        [buffer]
      )
    }

    return { storeName: res.storeName, tree: res.tree }
  }

  async listFolder(folderId: string): Promise<MessageSummary[]> {
    const res = await this.call<Extract<WorkerResponse, { kind: 'folderListed' }>>({
      kind: 'listFolder',
      folderId,
    })
    return res.items
  }

  async getMessage(folderId: string, messageId: string): Promise<MessageDetail> {
    const res = await this.call<Extract<WorkerResponse, { kind: 'message' }>>({
      kind: 'getMessage',
      folderId,
      messageId,
    })
    return res.detail
  }

  async getAttachment(
    folderId: string,
    messageId: string,
    attachmentIndex: number
  ): Promise<{ filename: string; mimeType: string; buffer: ArrayBuffer }> {
    const res = await this.call<Extract<WorkerResponse, { kind: 'attachment' }>>({
      kind: 'getAttachment',
      folderId,
      messageId,
      attachmentIndex,
    })
    return res
  }

  /** Searches every folder's background-built header index — subject,
   * sender, and To/Cc, not message bodies (those aren't indexed; see
   * README's Limitations). Covers whatever has been indexed so far, which
   * an IndexProgress alongside the results lets the caller disclose. */
  async searchArchive(query: string, limit = 200): Promise<SearchHit[]> {
    const res = await this.call<Extract<WorkerResponse, { kind: 'searchResults' }>>({
      kind: 'searchArchive',
      query,
      limit,
    })
    return res.hits
  }

  async controlIndex(action: IndexControlAction): Promise<void> {
    await this.call<Extract<WorkerResponse, { kind: 'indexControlAck' }>>({
      kind: 'indexControl',
      action,
    })
  }

  dispose() {
    if (!this.deadReason) this.deadReason = 'This file was closed.'
    this.worker.terminate()
    this.failAll(new PstCancelledError())
  }
}

export type { AttachmentMeta, FolderNode, MessageDetail, MessageSummary }
