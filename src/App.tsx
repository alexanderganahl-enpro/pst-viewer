import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from './components/EmptyState'
import { FolderTree } from './components/FolderTree'
import { MessageList } from './components/MessageList'
import { ReadingPane } from './components/ReadingPane'
import { TopBar } from './components/TopBar'
import { PstCancelledError, PstClient } from './lib/pstClient'
import type { AttachmentMeta, FolderNode, MessageDetail, MessageSummary } from './types'
import { LAZY_MODE_THRESHOLD_BYTES } from './types'

function findFolder(node: FolderNode, id: string): FolderNode | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findFolder(child, id)
    if (found) return found
  }
  return null
}

const GB = 1024 ** 3

// Below LAZY_MODE_THRESHOLD_BYTES the whole file is read into memory once,
// which is simple and fast for anything that comfortably fits. At/above
// it, pstClient switches to reading the file from disk on demand instead
// (see lazyFileSource.ts) — memory use stays low regardless of file size,
// at some cost to browsing speed. Let people know which mode they're
// getting, since it changes what to expect.
function largeFileHint(size: number): string | null {
  if (size >= LAZY_MODE_THRESHOLD_BYTES) {
    return `This file is ${(size / GB).toFixed(1)} GB. Above ${(LAZY_MODE_THRESHOLD_BYTES / GB).toFixed(0)} GB, this app reads it from disk on demand rather than loading it all into memory, so memory use stays low — but browsing may be a bit slower, especially on a slower disk.`
  }
  return null
}

function downloadBlob(filename: string, mimeType: string, buffer: ArrayBuffer) {
  const blob = new Blob([buffer], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to pick up the object URL before revoking it.
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function App() {
  const clientRef = useRef<PstClient | null>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [tree, setTree] = useState<FolderNode | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const [selectedFolder, setSelectedFolder] = useState<FolderNode | null>(null)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)

  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)
  const [messageError, setMessageError] = useState<string | null>(null)

  const reset = useCallback(() => {
    clientRef.current?.dispose()
    clientRef.current = null
    setFileName(null)
    setFileSize(null)
    setTree(null)
    setSelectedFolder(null)
    setMessages([])
    setSelectedMessage(null)
    setSelectedMessageId(null)
    setOpenError(null)
    setFolderError(null)
    setMessageError(null)
  }, [])

  const openFile = useCallback(async (file: File) => {
    const isPst = /\.(pst|ost)$/i.test(file.name)
    if (!isPst) {
      setOpenError('That doesn’t look like a .pst or .ost file. Please choose an Outlook data file.')
      return
    }

    setOpening(true)
    setOpenError(null)
    setFileName(file.name)
    setFileSize(file.size)
    clientRef.current?.dispose()
    const client = new PstClient()
    clientRef.current = client

    try {
      const { tree: newTree } = await client.open(file)
      setTree(newTree)
      const firstWithContent = newTree.children.find((c) => c.totalCount > 0) ?? newTree.children[0] ?? newTree
      setSelectedFolder(firstWithContent)
    } catch (err) {
      client.dispose()
      clientRef.current = null
      setFileName(null)
      setFileSize(null)
      setOpenError(
        err instanceof Error
          ? `Couldn't read this file: ${err.message}`
          : "Couldn't read this file. It may be corrupt, password-protected, or not a valid PST."
      )
    } finally {
      setOpening(false)
    }
  }, [])

  // Load the message list whenever the selected folder changes.
  useEffect(() => {
    const client = clientRef.current
    if (!client || !selectedFolder) {
      setMessages([])
      return
    }
    let cancelled = false
    setMessagesLoading(true)
    setSelectedMessage(null)
    setSelectedMessageId(null)
    setMessageError(null)
    setFolderError(null)
    client
      .listFolder(selectedFolder.id)
      .then((items) => {
        if (!cancelled) setMessages(items)
      })
      .catch((err) => {
        if (cancelled || err instanceof PstCancelledError) return
        console.error(err)
        setMessages([])
        setFolderError(err instanceof Error ? err.message : 'Could not read this folder.')
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFolder])

  // Tracks the most recently requested message so a slow earlier response
  // can't overwrite a newer selection when they resolve out of order.
  const latestMessageRequest = useRef<string | null>(null)

  const handleSelectMessage = useCallback(
    (message: MessageSummary) => {
      const client = clientRef.current
      if (!client || !selectedFolder) return
      latestMessageRequest.current = message.id
      setSelectedMessageId(message.id)
      setMessageLoading(true)
      setMessageError(null)
      client
        .getMessage(selectedFolder.id, message.id)
        .then((detail) => {
          if (latestMessageRequest.current !== message.id) return
          setSelectedMessage(detail)
        })
        .catch((err) => {
          if (latestMessageRequest.current !== message.id) return
          if (err instanceof PstCancelledError) return
          console.error(err)
          setSelectedMessage(null)
          setMessageError(err instanceof Error ? err.message : 'Could not open this message.')
        })
        .finally(() => {
          if (latestMessageRequest.current === message.id) setMessageLoading(false)
        })
    },
    [selectedFolder]
  )

  const handleDownloadAttachment = useCallback(
    async (attachment: AttachmentMeta) => {
      const client = clientRef.current
      if (!client || !selectedFolder || !selectedMessageId) return
      try {
        const { filename, mimeType, buffer } = await client.getAttachment(
          selectedFolder.id,
          selectedMessageId,
          attachment.index
        )
        downloadBlob(filename, mimeType, buffer)
      } catch (err) {
        // Without this the rejection escapes as an unhandled promise
        // rejection and the user sees nothing at all.
        if (err instanceof PstCancelledError) return
        console.error(err)
        setMessageError(
          err instanceof Error
            ? `Couldn't save "${attachment.filename}": ${err.message}`
            : `Couldn't save "${attachment.filename}".`
        )
      }
    },
    [selectedFolder, selectedMessageId]
  )

  // Whole-window drag & drop.
  useEffect(() => {
    let dragDepth = 0
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth++
      setIsDragging(true)
    }
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    const onDragLeave = () => {
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setIsDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth = 0
      setIsDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) void openFile(file)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [openFile])

  useEffect(() => () => clientRef.current?.dispose(), [])

  return (
    <div className="app">
      <TopBar fileName={fileName} fileSize={fileSize} onOpenFile={(f) => void openFile(f)} onClose={reset} />
      {tree ? (
        <div className="app__body">
          <aside className="app__folders">
            <FolderTree
              root={tree}
              selectedId={selectedFolder?.id ?? null}
              onSelect={(folder) => {
                // Invalidate any in-flight message request before the folder
                // changes, so a late reply can't land in the new folder's pane.
                latestMessageRequest.current = null
                setSelectedFolder(findFolder(tree, folder.id))
              }}
            />
          </aside>
          <MessageList
            key={selectedFolder?.id}
            folder={selectedFolder}
            messages={messages}
            loading={messagesLoading}
            error={folderError}
            selectedId={selectedMessageId}
            onSelect={handleSelectMessage}
          />
          <ReadingPane
            message={selectedMessage}
            loading={messageLoading}
            error={messageError}
            onDownloadAttachment={handleDownloadAttachment}
          />
        </div>
      ) : (
        <EmptyState onOpenFile={(f) => void openFile(f)} isDragging={isDragging} error={openError} />
      )}
      {opening && (
        <div className="loading-overlay">
          <div className="loading-overlay__card">
            <div className="spinner" />
            <p>Reading {fileName ?? 'file'}…</p>
            <p className="loading-overlay__hint">
              {/* `??` would not catch the `false` that `&&` yields when
                  fileSize is null, so the fallback never rendered. */}
              {(fileSize !== null ? largeFileHint(fileSize) : null) ||
                'Large files can take a little while — everything is happening locally.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
