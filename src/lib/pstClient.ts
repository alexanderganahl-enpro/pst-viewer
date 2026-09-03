import type {
  AttachmentMeta,
  FolderNode,
  MessageDetail,
  MessageSummary,
  WorkerRequest,
  WorkerResponse,
} from '../types'

// Distributive Omit: applying Omit<T, K> directly to a discriminated union
// collapses it to the shared-key intersection. This preserves each variant.
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never
type WorkerRequestNoId = DistributiveOmit<WorkerRequest, 'reqId'>

/** Promise-based wrapper around the PST parsing worker. One instance is
 * created per opened file; call dispose() when done with it. */
export class PstClient {
  private worker: Worker
  private nextReqId = 1
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void }
  >()

  constructor() {
    this.worker = new Worker(new URL('../worker/pstWorker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const res = event.data
      const entry = this.pending.get(res.reqId)
      if (!entry) return
      this.pending.delete(res.reqId)
      if (res.kind === 'error') {
        entry.reject(new Error(res.message))
      } else {
        entry.resolve(res)
      }
    }
    this.worker.onerror = (event) => {
      // Fails every still-pending request; the worker thread itself is
      // still alive (this fires on uncaught errors inside handlers).
      const error = new Error(event.message || 'PST worker crashed')
      for (const [, entry] of this.pending) entry.reject(error)
      this.pending.clear()
    }
  }

  private call<T extends WorkerResponse>(
    req: WorkerRequestNoId,
    transfer?: Transferable[]
  ): Promise<T> {
    const reqId = this.nextReqId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject })
      this.worker.postMessage({ ...req, reqId } as WorkerRequest, transfer ?? [])
    })
  }

  async open(
    file: File
  ): Promise<{ storeName: string; tree: FolderNode }> {
    const buffer = await file.arrayBuffer()
    // Transfer (not clone) the buffer into the worker — for a multi-GB PST
    // this is the difference between one copy in memory and two at the
    // exact moment memory pressure is highest. `buffer` is detached on the
    // main thread after this call, which is fine: nothing here reads it
    // again.
    const res = await this.call<Extract<WorkerResponse, { kind: 'opened' }>>(
      {
        kind: 'open',
        fileName: file.name,
        fileSize: file.size,
        buffer,
      },
      [buffer]
    )
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

  dispose() {
    this.worker.terminate()
    this.pending.clear()
  }
}

export type { AttachmentMeta, FolderNode, MessageDetail, MessageSummary }
