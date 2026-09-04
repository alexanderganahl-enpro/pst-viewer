import { useRef } from 'react'
import { CloseIcon, LockIcon, MailIcon, OpenFileIcon } from './Icons'

interface TopBarProps {
  fileName: string | null
  fileSize: number | null
  onOpenFile: (file: File) => void
  onClose: () => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function TopBar({ fileName, fileSize, onOpenFile, onClose }: TopBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="top-bar">
      <div className="top-bar__brand">
        <span className="top-bar__logo">
          <MailIcon width={20} height={20} />
        </span>
        <span className="top-bar__title">PST Viewer</span>
      </div>

      <div className="top-bar__center">
        {fileName ? (
          <div className="top-bar__file">
            <span className="top-bar__file-name">{fileName}</span>
            <span className="top-bar__file-size">{fileSize !== null ? formatBytes(fileSize) : ''}</span>
            <button type="button" className="top-bar__close" onClick={onClose} title="Close file">
              <CloseIcon width={14} height={14} />
            </button>
          </div>
        ) : (
          <span className="top-bar__hint">No file open</span>
        )}
      </div>

      <div className="top-bar__actions">
        <span className="privacy-badge" title="This file is parsed locally in your browser tab. Nothing is uploaded, streamed, or sent anywhere.">
          <LockIcon width={14} height={14} />
          100% local
        </span>
        <button type="button" className="btn btn--primary" onClick={() => inputRef.current?.click()}>
          <OpenFileIcon width={16} height={16} />
          Open PST file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pst,.ost"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onOpenFile(file)
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
