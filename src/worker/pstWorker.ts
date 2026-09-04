/// <reference lib="webworker" />
/**
 * All PST parsing happens in this worker.
 *
 * The file the user picks is never written anywhere and never sent over
 * the network — this worker has no network access of its own — but it can
 * be read one of two ways, decided by size in pstClient.ts:
 *
 *  - "eager" (the default, smaller files): read once into an ArrayBuffer
 *    on the main thread and transferred here.
 *  - "lazy" (files at/above LAZY_MODE_THRESHOLD_BYTES): the `File` object
 *    itself is handed over, and bytes are read on demand straight off
 *    disk via lazyFileSource.ts, so the whole file is never resident in
 *    memory at once. See that file and README.md's Limitations section.
 *
 * Either way, everything below just walks the PST's own B-tree structure.
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
import { createLazyFileSource } from './lazyFileSource'
import { sanitizeFilename } from './sanitizeFilename'

// Folder id -> live PSTFolder instance, so we can re-enter a folder later
// without re-walking the tree. Folder objects themselves are lightweight
// (a wrapper over one table row), so this is never cleared during a
// session — only on 'open'.
const folderById = new Map<string, PSTFolder>()

/** A folder's materialized messages, plus an id index so opening a message
 * is a hash lookup rather than a linear scan with a Long->string conversion
 * per message. */
interface FolderMessages {
  items: PSTMessage[]
  byId: Map<string, PSTMessage>
}

// Cached after a folder's first visit so re-opening it is instant. Each
// PSTMessage holds its own decoded property table, so this is capped two
// ways: by folder count, and by total messages retained — five 100k-message
// folders is a lot of resident state even though it's only five entries.
// `Map` preserves insertion order, which is all an LRU needs: touch moves a
// key to the end, and the oldest is whatever key iteration yields first.
const MAX_CACHED_FOLDERS = 5
const MAX_CACHED_MESSAGES = 50_000
const messagesByFolder = new Map<string, FolderMessages>()

function cachedMessageCount(): number {
  let total = 0
  for (const entry of messagesByFolder.values()) total += entry.items.length
  return total
}

function touchFolderCache(folderId: string, entry: FolderMessages) {
  messagesByFolder.delete(folderId)
  messagesByFolder.set(folderId, entry)
  while (
    messagesByFolder.size > MAX_CACHED_FOLDERS ||
    (messagesByFolder.size > 1 && cachedMessageCount() > MAX_CACHED_MESSAGES)
  ) {
    const oldest = messagesByFolder.keys().next().value
    if (oldest === undefined || oldest === folderId) break
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

function loadFolderMessages(folderId: string): FolderMessages {
  const cached = messagesByFolder.get(folderId)
  if (cached) {
    touchFolderCache(folderId, cached) // mark as most-recently-used
    return cached
  }

  const folder = folderById.get(folderId)
  if (!folder) throw new Error('Unknown folder')

  const items: PSTMessage[] = []
  const byId = new Map<string, PSTMessage>()
  folder.moveChildCursorTo(0)
  let child = folder.getNextChild()
  while (child) {
    if (child instanceof PSTMessage) {
      items.push(child)
      byId.set(messageId(child), child)
    }
    child = folder.getNextChild()
  }
  const entry = { items, byId }
  touchFolderCache(folderId, entry)
  return entry
}

function messageId(message: PSTMessage): string {
  return message.descriptorNodeId.toString()
}

function toSummary(message: PSTMessage): MessageSummary {
  const date = message.messageDeliveryTime ?? message.clientSubmitTime
  return {
    id: messageId(message),
    subject: safeText(message.subject) || '(No subject)',
    fromName: safeText(message.senderName),
    fromEmail: safeText(message.senderEmailAddress),
    toDisplay: safeText(message.displayTo),
    date: date ? date.toISOString() : null,
    preview: safeText(message.bodyPrefix).replace(/\s+/g, ' ').slice(0, 180),
    isRead: message.isRead,
    hasAttachments: message.hasAttachments,
    importance: message.importance,
  }
}

function toAttachmentMeta(attachment: PSTAttachment, index: number): AttachmentMeta {
  const rawName = safeText(attachment.longFilename) || safeText(attachment.filename)
  const fallback = `attachment-${index + 1}`
  return {
    index,
    // Sanitized here, at the boundary where untrusted PST data enters the
    // app, so the name shown in the UI and the name a download is saved
    // under can never disagree. See sanitizeFilename.ts.
    filename: rawName ? sanitizeFilename(rawName, fallback) : fallback,
    size: Math.max(0, attachment.size ?? 0),
    mimeType: safeText(attachment.mimeTag) || 'application/octet-stream',
    isEmbeddedMessage: !rawName && !!attachment.embeddedPSTMessage,
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
    id: messageId(message),
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

function findMessage(folderId: string, id: string): PSTMessage {
  const found = loadFolderMessages(folderId).byId.get(id)
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
        const lazy =
          req.source.mode === 'lazy'
            ? createLazyFileSource(req.source.file, req.fileSize)
            : null
        const buffer =
          req.source.mode === 'eager' ? Buffer.from(req.source.buffer) : lazy!.source
        const pstFile = new PSTFile(buffer)
        // Fails loudly if a pst-extractor upgrade ever stops routing reads
        // through the one call site lazyFileSource.ts substitutes itself
        // into — otherwise that change would surface as silently wrong
        // bytes rather than an error. See lazyFileSource.ts.
        lazy?.assertWasUsed()
        const root = pstFile.getRootFolder()
        const storeName =
          safeText(pstFile.getMessageStore().displayName) || req.fileName
        const tree = buildFolderNode(root, 'root')
        tree.name = storeName
        post({ kind: 'opened', reqId: req.reqId, storeName, tree })
        break
      }
      case 'listFolder': {
        const items = loadFolderMessages(req.folderId).items.map(toSummary)
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
        // Do NOT trust attachment.size (the PR_ATTACH_SIZE MAPI property)
        // as the read length — it can disagree with the underlying
        // stream's actual length (observed on a real PST: size=257 vs
        // stream.length=120), and pst-extractor's readCompletely()/
        // readBlock() has a latent bug where asking for more bytes than
        // the stream truly has spins forever rather than erroring: its
        // EOF check compares two `Long` objects with `==` (reference
        // equality — always false for equal-but-distinct instances) so it
        // never fires, and readBlock falls through to correctly compute
        // zero bytes remaining but returns 0 instead of the -1 EOF
        // sentinel readCompletely's `while (offset < target.length)` loop
        // expects — offset then never advances, and the loop spins at
        // 100% CPU indefinitely. Capping the request to what the stream
        // actually reports avoids ever taking that path.
        const readLength = Math.max(
          0,
          Math.min(meta.size, stream.length.toNumber() || 0)
        )
        const out = Buffer.alloc(readLength)
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
