/// <reference lib="webworker" />
/**
 * All PST parsing happens in this worker, entirely in memory.
 *
 * The file the user picks is read once into an ArrayBuffer on the main
 * thread and transferred here — it is never written anywhere, never sent
 * over the network, and this worker has no network access of its own.
 * Everything below just walks the PST's own B-tree structure in RAM.
 */
import { Buffer } from 'buffer'
import { PSTAttachment, PSTFile, PSTFolder, PSTMessage } from 'pst-extractor'
import type {
  AttachmentMeta,
  FolderNode,
  MessageDetail,
  MessageSummary,
  WorkerRequest,
  WorkerResponse,
} from '../types'

let pstFile: PSTFile | null = null
// Folder id -> live PSTFolder instance, so we can re-enter a folder later
// without re-walking the tree. Folder objects themselves are lightweight
// (a wrapper over one table row), so this is never cleared during a
// session — only on 'open'.
const folderById = new Map<string, PSTFolder>()

// Folder id -> the fully-materialized message list for that folder, cached
// after the first visit so re-opening a folder is instant. Each PSTMessage
// holds its own decoded property table, so for a mailbox with many large
// folders this can add up — cap how many folders' worth we keep resident
// and evict the least-recently-used one once we're over the cap. `Map`
// preserves insertion order, which is all an LRU needs here: touch moves a
// key to the end, and the oldest is whatever key iteration yields first.
const MAX_CACHED_FOLDERS = 5
const messagesByFolder = new Map<string, PSTMessage[]>()

function touchFolderCache(folderId: string, items: PSTMessage[]) {
  messagesByFolder.delete(folderId)
  messagesByFolder.set(folderId, items)
  while (messagesByFolder.size > MAX_CACHED_FOLDERS) {
    const oldest = messagesByFolder.keys().next().value
    if (oldest === undefined) break
    messagesByFolder.delete(oldest)
  }
}

function post(message: WorkerResponse, transfer?: Transferable[]) {
  // @ts-expect-error - postMessage overload with transfer list
  self.postMessage(message, transfer)
}

function safeText(value: string | null | undefined): string {
  return value ? value.trim() : ''
}

function buildFolderNode(folder: PSTFolder, idPrefix: string): FolderNode {
  const id = idPrefix
  folderById.set(id, folder)

  let children: FolderNode[] = []
  if (folder.hasSubfolders) {
    children = folder
      .getSubFolders()
      .map((child, i) => buildFolderNode(child, `${id}/${i}`))
  }

  return {
    id,
    name: safeText(folder.displayName) || '(Unnamed folder)',
    totalCount: Math.max(folder.contentCount ?? 0, 0),
    unreadCount: Math.max(folder.unreadCount ?? 0, 0),
    children,
  }
}

function loadFolderMessages(folderId: string): PSTMessage[] {
  const cached = messagesByFolder.get(folderId)
  if (cached) {
    touchFolderCache(folderId, cached) // mark as most-recently-used
    return cached
  }

  const folder = folderById.get(folderId)
  if (!folder) throw new Error('Unknown folder')

  const items: PSTMessage[] = []
  folder.moveChildCursorTo(0)
  let child = folder.getNextChild()
  while (child) {
    if (child instanceof PSTMessage) items.push(child)
    child = folder.getNextChild()
  }
  touchFolderCache(folderId, items)
  return items
}

function toSummary(message: PSTMessage, index: number): MessageSummary {
  const date = message.messageDeliveryTime ?? message.clientSubmitTime
  return {
    id: `${message.descriptorNodeId.toString()}`,
    index,
    subject: safeText(message.subject) || '(No subject)',
    fromName: safeText(message.senderName),
    fromEmail: safeText(message.senderEmailAddress),
    toDisplay: safeText(message.displayTo),
    date: date ? date.toISOString() : null,
    preview: safeText(message.bodyPrefix).replace(/\s+/g, ' ').slice(0, 180),
    isRead: message.isRead,
    hasAttachments: message.hasAttachments,
    attachmentCount: message.numberOfAttachments ?? 0,
    importance: message.importance,
  }
}

function toAttachmentMeta(attachment: PSTAttachment, index: number): AttachmentMeta {
  const name = safeText(attachment.longFilename) || safeText(attachment.filename)
  return {
    index,
    filename: name || `attachment-${index + 1}`,
    size: attachment.size ?? 0,
    mimeType: safeText(attachment.mimeTag) || 'application/octet-stream',
    isEmbeddedMessage: !name && !!attachment.embeddedPSTMessage,
  }
}

function toDetail(message: PSTMessage): MessageDetail {
  const date = message.messageDeliveryTime ?? message.clientSubmitTime
  const attachments: AttachmentMeta[] = []
  const count = message.numberOfAttachments ?? 0
  for (let i = 0; i < count; i++) {
    try {
      attachments.push(toAttachmentMeta(message.getAttachment(i), i))
    } catch {
      // A malformed/unsupported attachment shouldn't take down the whole
      // message view — skip it.
    }
  }

  let bodyHtml: string | null = null
  let bodyText: string | null = null
  try {
    bodyHtml = message.bodyHTML || null
  } catch {
    bodyHtml = null
  }
  try {
    bodyText = message.body || null
  } catch {
    bodyText = null
  }

  return {
    id: `${message.descriptorNodeId.toString()}`,
    subject: safeText(message.subject) || '(No subject)',
    fromName: safeText(message.senderName),
    fromEmail: safeText(message.senderEmailAddress),
    toDisplay: safeText(message.displayTo),
    ccDisplay: safeText(message.displayCC),
    bccDisplay: safeText(message.displayBCC),
    date: date ? date.toISOString() : null,
    importance: message.importance,
    bodyHtml,
    bodyText,
    attachments,
  }
}

function findMessage(folderId: string, messageId: string): PSTMessage {
  const items = loadFolderMessages(folderId)
  const found = items.find((m) => `${m.descriptorNodeId.toString()}` === messageId)
  if (!found) throw new Error('Message not found in folder')
  return found
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    switch (req.kind) {
      case 'open': {
        folderById.clear()
        messagesByFolder.clear()
        const buffer = Buffer.from(req.buffer)
        pstFile = new PSTFile(buffer)
        const root = pstFile.getRootFolder()
        const storeName =
          safeText(pstFile.getMessageStore().displayName) || req.fileName
        const tree = buildFolderNode(root, 'root')
        tree.name = storeName
        post({ kind: 'opened', reqId: req.reqId, storeName, tree })
        break
      }
      case 'listFolder': {
        const items = loadFolderMessages(req.folderId).map(toSummary)
        post({ kind: 'folderListed', reqId: req.reqId, items })
        break
      }
      case 'getMessage': {
        const message = findMessage(req.folderId, req.messageId)
        const detail = toDetail(message)
        post({ kind: 'message', reqId: req.reqId, detail })
        break
      }
      case 'getAttachment': {
        const message = findMessage(req.folderId, req.messageId)
        const attachment = message.getAttachment(req.attachmentIndex)
        const meta = toAttachmentMeta(attachment, req.attachmentIndex)
        const stream = attachment.fileInputStream
        if (!stream) throw new Error('This attachment has no readable content')
        const out = Buffer.alloc(attachment.size)
        stream.readCompletely(out)
        const arrayBuffer = out.buffer.slice(
          out.byteOffset,
          out.byteOffset + out.byteLength
        ) as ArrayBuffer
        post(
          {
            kind: 'attachment',
            reqId: req.reqId,
            filename: meta.filename,
            mimeType: meta.mimeType,
            buffer: arrayBuffer,
          },
          [arrayBuffer]
        )
        break
      }
    }
  } catch (err) {
    post({
      kind: 'error',
      reqId: req.reqId,
      message: err instanceof Error ? err.message : 'Unknown error reading PST file',
    })
  }
}
