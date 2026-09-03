import { useMemo, useState } from 'react'
import type { FolderNode, MessageSummary } from '../types'
import { PaperclipIcon, SearchIcon } from './Icons'
import { VirtualList } from './VirtualList'

interface MessageListProps {
  folder: FolderNode | null
  messages: MessageSummary[]
  loading: boolean
  selectedId: string | null
  onSelect: (message: MessageSummary) => void
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  })
}

export function MessageList({ folder, messages, loading, selectedId, onSelect }: MessageListProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return messages
    return messages.filter(
      (m) =>
        m.subject.toLowerCase().includes(q) ||
        m.fromName.toLowerCase().includes(q) ||
        m.fromEmail.toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q)
    )
  }, [messages, query])

  return (
    <section className="message-list-pane">
      <div className="message-list-header">
        <h2 className="message-list-title">{folder ? folder.name : 'Messages'}</h2>
        <span className="message-list-count">
          {loading ? 'Loading…' : `${filtered.length.toLocaleString()} item${filtered.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="search-box">
        <SearchIcon width={16} height={16} />
        <input
          type="text"
          placeholder="Search this folder"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!folder || messages.length === 0}
        />
      </div>
      {loading ? (
        <div className="pane-status">Reading folder…</div>
      ) : (
        <VirtualList
          items={filtered}
          rowHeight={72}
          emptyState={
            <div className="pane-status">
              {folder ? (query ? 'No messages match your search.' : 'This folder is empty.') : 'Select a folder to view its messages.'}
            </div>
          }
          renderRow={(m) => (
            <button
              type="button"
              className={`message-row${selectedId === m.id ? ' message-row--selected' : ''}${m.isRead ? '' : ' message-row--unread'}`}
              onClick={() => onSelect(m)}
            >
              <span className="message-row__unread-dot" aria-hidden={m.isRead} />
              <span className="message-row__body">
                <span className="message-row__top">
                  <span className="message-row__from">{m.fromName || m.fromEmail || 'Unknown sender'}</span>
                  <span className="message-row__date">{formatDate(m.date)}</span>
                </span>
                <span className="message-row__subject">
                  {m.subject}
                  {m.hasAttachments && <PaperclipIcon width={13} height={13} className="message-row__clip" />}
                </span>
                <span className="message-row__preview">{m.preview || 'No preview available'}</span>
              </span>
            </button>
          )}
        />
      )}
    </section>
  )
}
