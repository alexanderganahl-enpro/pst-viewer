import { useState } from 'react'
import type { AttachmentMeta, MessageDetail } from '../types'
import { AlertIcon, DownloadIcon, MailIcon, PaperclipIcon, PersonIcon } from './Icons'
import { SandboxedHtmlBody } from './SandboxedHtmlBody'

interface ReadingPaneProps {
  message: MessageDetail | null
  loading: boolean
  onDownloadAttachment: (attachment: AttachmentMeta) => Promise<void>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatFullDate(iso: string | null): string {
  if (!iso) return 'Unknown date'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown date'
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function initials(name: string, email: string): string {
  const source = name || email
  const parts = source.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function ReadingPane({ message, loading, onDownloadAttachment }: ReadingPaneProps) {
  const [pending, setPending] = useState<number | null>(null)

  if (loading) {
    return (
      <section className="reading-pane">
        <div className="pane-status">Loading message…</div>
      </section>
    )
  }

  if (!message) {
    return (
      <section className="reading-pane">
        <div className="reading-pane__placeholder">
          <MailIcon width={40} height={40} />
          <p>Select an item to read</p>
        </div>
      </section>
    )
  }

  const handleDownload = async (attachment: AttachmentMeta) => {
    setPending(attachment.index)
    try {
      await onDownloadAttachment(attachment)
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="reading-pane" aria-label="Reading pane">
      <div className="reading-pane__scroll">
        <header className="message-header">
          <h1 className="message-header__subject">
            {message.importance === 2 && (
              <AlertIcon width={16} height={16} className="message-header__high-importance" />
            )}
            {message.subject}
          </h1>
          <div className="message-header__meta">
            <div className="message-header__avatar" aria-hidden="true">
              {initials(message.fromName, message.fromEmail)}
            </div>
            <div className="message-header__lines">
              <div className="message-header__from">
                <strong>{message.fromName || message.fromEmail || 'Unknown sender'}</strong>
                {message.fromEmail && message.fromName && (
                  <span className="message-header__email"> &lt;{message.fromEmail}&gt;</span>
                )}
              </div>
              <div className="message-header__date">{formatFullDate(message.date)}</div>
              {message.toDisplay && (
                <div className="message-header__recipients">
                  <PersonIcon width={13} height={13} /> To: {message.toDisplay}
                </div>
              )}
              {message.ccDisplay && (
                <div className="message-header__recipients">Cc: {message.ccDisplay}</div>
              )}
            </div>
          </div>
        </header>

        {message.attachments.length > 0 && (
          <div className="attachment-strip">
            {message.attachments.map((a) => (
              <button
                key={a.index}
                type="button"
                className="attachment-chip"
                disabled={a.isEmbeddedMessage || pending === a.index}
                onClick={() => handleDownload(a)}
                title={a.isEmbeddedMessage ? 'Embedded message (not downloadable in this preview)' : `Save ${a.filename}`}
              >
                <PaperclipIcon width={14} height={14} />
                <span className="attachment-chip__name">{a.filename}</span>
                <span className="attachment-chip__size">{formatBytes(a.size)}</span>
                {!a.isEmbeddedMessage && (
                  <DownloadIcon width={14} height={14} className="attachment-chip__download" />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="message-body">
          {message.bodyHtml ? (
            <SandboxedHtmlBody html={message.bodyHtml} />
          ) : message.bodyText ? (
            <pre className="message-body__plain">{message.bodyText}</pre>
          ) : (
            <p className="pane-status">
              This item has no readable body (it may use a format this preview doesn't support, such
              as RTF-only content).
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
