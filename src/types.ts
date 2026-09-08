/** Shared types passed between the main thread and the PST parsing worker.
 *
 *  Everything here has to survive structured cloning, so no library class
 *  instances (no Long, no Buffer) — but the platform types the algorithm
 *  natively clones, notably File and ArrayBuffer, are fine and are used
 *  deliberately in the open request. */

export interface FolderNode {
  id: string
  name: string
  totalCount: number
  unreadCount: number
  children: FolderNode[]
}

export interface MessageSummary {
  id: string
  subject: string
  fromName: string
  fromEmail: string
  toDisplay: string
  date: string | null
  preview: string
  isRead: boolean
  hasAttachments: boolean
  importance: number
}

export interface AttachmentMeta {
  index: number
  filename: string
  size: number
  mimeType: string
  isEmbeddedMessage: boolean
}

export interface MessageDetail {
  id: string
  subject: string
  fromName: string
  fromEmail: string
  toDisplay: string
  ccDisplay: string
  bccDisplay: string
  date: string | null
  importance: number
  bodyHtml: string | null
  bodyText: string | null
  attachments: AttachmentMeta[]
}

/**
 * Progress of the background header index — see
 * src/worker/backgroundIndexer.ts. Pushed from the worker on a throttled
 * cadence; not a response to any one request.
 *
 *  - `running`  actively indexing.
 *  - `paused`   user-paused; whatever's indexed so far is still searchable.
 *  - `done`     every folder is indexed (live or loaded from cache).
 *  - `capped`   hit the memory ceiling; search covers what's indexed, and
 *               only that.
 *  - `stopped`  user chose "Skip indexing"; same partial-coverage story as
 *               `capped`, just user-initiated instead of a safety limit.
 *  - `idle`     nothing has been opened yet.
 */
export type IndexState = 'running' | 'paused' | 'done' | 'capped' | 'stopped' | 'idle'

export interface IndexProgress {
  totalMessages: number
  indexedMessages: number
  foldersTotal: number
  foldersDone: number
  currentFolderName: string | null
  state: IndexState
}

export interface SearchHit {
  folderId: string
  folderName: string
  messageId: string
  subject: string
  fromName: string
  date: string | null
}

export type IndexControlAction = 'pause' | 'resume' | 'stop' | 'clearCache'

/** Files at or above this size are opened in "lazy" mode: the worker reads
 * byte ranges on demand straight from the `File` (via `File.slice()` +
 * `FileReaderSync`) instead of loading the whole thing into memory up
 * front. Below it, reading the whole file once is simpler and, for
 * anything that comfortably fits in memory, faster. See
 * src/worker/lazyFileSource.ts and README.md's Limitations section. */
export const LAZY_MODE_THRESHOLD_BYTES = 1024 ** 3 // 1 GiB

/** How the worker should get at the opened file's bytes. */
export type FileSource =
  | { mode: 'eager'; buffer: ArrayBuffer }
  | { mode: 'lazy'; file: File }

/* ---- Worker request / response protocol ---- */

export type WorkerRequest =
  | {
      kind: 'open'
      reqId: number
      fileName: string
      fileSize: number
      /** From `File.lastModified`. Passed explicitly (rather than reread
       * from a retained File) because eager mode only ever hands the
       * worker an ArrayBuffer — this is the cheap fingerprint the
       * background indexer keys its IndexedDB cache on. */
      lastModified: number
      source: FileSource
    }
  | { kind: 'listFolder'; reqId: number; folderId: string }
  | { kind: 'getMessage'; reqId: number; folderId: string; messageId: string }
  | {
      kind: 'getAttachment'
      reqId: number
      folderId: string
      messageId: string
      attachmentIndex: number
    }
  | { kind: 'searchArchive'; reqId: number; query: string; limit: number }
  | { kind: 'indexControl'; reqId: number; action: IndexControlAction }

export type WorkerResponse =
  | { kind: 'opened'; reqId: number; storeName: string; tree: FolderNode }
  | { kind: 'folderListed'; reqId: number; items: MessageSummary[] }
  | { kind: 'message'; reqId: number; detail: MessageDetail }
  | {
      kind: 'attachment'
      reqId: number
      filename: string
      mimeType: string
      buffer: ArrayBuffer
    }
  | { kind: 'searchResults'; reqId: number; hits: SearchHit[] }
  | { kind: 'indexControlAck'; reqId: number }
  /** Pushed unprompted, not a reply to any request — see IndexProgress. */
  | { kind: 'indexProgress'; progress: IndexProgress }
  | { kind: 'error'; reqId: number; message: string }
