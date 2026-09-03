import { useRef } from 'react'
import { LockIcon, OpenFileIcon } from './Icons'

interface EmptyStateProps {
  onOpenFile: (file: File) => void
  isDragging: boolean
  error: string | null
}

export function EmptyState({ onOpenFile, isDragging, error }: EmptyStateProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`empty-state${isDragging ? ' empty-state--dragging' : ''}`}>
      <div className="empty-state__card">
        <div className="empty-state__icon">
          <OpenFileIcon width={36} height={36} />
        </div>
        <h1>Browse a PST file, right here in your browser</h1>
        <p className="empty-state__lead">
          Open an Outlook <code>.pst</code> (or <code>.ost</code>) file to browse its folders,
          messages, and attachments — read-only, nothing is changed.
        </p>
        <button type="button" className="btn btn--primary btn--large" onClick={() => inputRef.current?.click()}>
          <OpenFileIcon width={18} height={18} />
          Choose a PST file
        </button>
        <p className="empty-state__or">or drag a file anywhere on this page</p>

        {error && <p className="empty-state__error">{error}</p>}

        <div className="empty-state__privacy">
          <LockIcon width={16} height={16} />
          <div>
            <strong>Nothing leaves this tab.</strong> The file is read directly from your disk into
            browser memory and parsed by JavaScript running locally — this app has no server and
            makes no network requests with your data.
          </div>
        </div>

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
    </div>
  )
}
