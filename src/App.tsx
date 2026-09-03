import { useCallback, useEffect, useRef, useState } from 'react'
import { EmptyState } from './components/EmptyState'
import { FolderTree } from './components/FolderTree'
import { MessageList } from './components/MessageList'
import { ReadingPane } from './components/ReadingPane'
import { TopBar } from './components/TopBar'
import { PstClient } from './lib/pstClient'
import type { AttachmentMeta, FolderNode, MessageDetail, MessageSummary } from './types'

function findFolder(node: FolderNode, id: string): FolderNode | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findFolder(child, id)
    if (found) return found
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

  const [selectedMessage, setSelectedMessage] = useState<MessageDetail | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [messageLoading, setMessageLoading] = useState(false)

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
    client
      .listFolder(selectedFolder.id)
      .then((items) => {
        if (!cancelled) setMessages(items)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err)
          setMessages([])
        }
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFolder])

  const handleSelectMessage = useCallback(
    (message: MessageSummary) => {
      const client = clientRef.current
      if (!client || !selectedFolder) return
      setSelectedMessageId(message.id)
      setMessageLoading(true)
      client
        .getMessage(selectedFolder.id, message.id)
        .then((detail) => setSelectedMessage(detail))
        .catch((err) => {
          console.error(err)
          setSelectedMessage(null)
        })
        .finally(() => setMessageLoading(false))
    },
    [selectedFolder]
  )

  const handleDownloadAttachment = useCallback(
    async (attachment: AttachmentMeta) => {
      const client = clientRef.current
      if (!client || !selectedFolder || !selectedMessageId) return
      const { filename, mimeType, buffer } = await client.getAttachment(
        selectedFolder.id,
        selectedMessageId,
        attachment.index
      )
      downloadBlob(filename, mimeType, buffer)
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
              onSelect={(folder) => setSelectedFolder(findFolder(tree, folder.id))}
            />
          </aside>
          <MessageList
            folder={selectedFolder}
            messages={messages}
            loading={messagesLoading}
            selectedId={selectedMessageId}
            onSelect={handleSelectMessage}
          />
          <ReadingPane message={selectedMessage} loading={messageLoading} onDownloadAttachment={handleDownloadAttachment} />
        </div>
      ) : (
        <EmptyState onOpenFile={(f) => void openFile(f)} isDragging={isDragging} error={openError} />
      )}
      {opening && (
        <div className="loading-overlay">
          <div className="loading-overlay__card">
            <div className="spinner" />
            <p>Reading {fileName ?? 'file'}…</p>
            <p className="loading-overlay__hint">Large files can take a little while — everything is happening locally.</p>
          </div>
        </div>
      )}
    </div>
  )
}
