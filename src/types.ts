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
  | { kind: 'open'; reqId: number; fileName: string; fileSize: number; source: FileSource }
  | { kind: 'listFolder'; reqId: number; folderId: string }
  | { kind: 'getMessage'; reqId: number; folderId: string; messageId: string }
  | {
      kind: 'getAttachment'
      reqId: number
      folderId: string
      messageId: string
      attachmentIndex: number
    }

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
  | { kind: 'error'; reqId: number; message: string }
