/** Shared types passed between the main thread and the PST parsing worker.
 *  Everything here has to be structured-clone friendly (no class instances,
 *  no Long, no Buffer) since it crosses a postMessage boundary. */

export interface FolderNode {
  id: string
  name: string
  totalCount: number
  unreadCount: number
  children: FolderNode[]
}

export interface MessageSummary {
  id: string
  index: number
  subject: string
  fromName: string
  fromEmail: string
  toDisplay: string
  date: string | null
  preview: string
  isRead: boolean
  hasAttachments: boolean
  attachmentCount: number
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

export interface OpenedFile {
  fileName: string
  fileSize: number
  storeName: string
  tree: FolderNode
}

/* ---- Worker request / response protocol ---- */

export type WorkerRequest =
  | { kind: 'open'; reqId: number; fileName: string; fileSize: number; buffer: ArrayBuffer }
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
