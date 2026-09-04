import { useDeferredValue, useMemo, useState } from 'react'
import type { FolderNode, MessageSummary } from '../types'
import { AlertIcon, PaperclipIcon, SearchIcon } from './Icons'
import { VirtualList } from './VirtualList'

interface MessageListProps {
  folder: FolderNode | null
  messages: MessageSummary[]
  loading: boolean
  error: string | null
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

export function MessageList({
  folder,
  messages,
  loading,
  error,
  selectedId,
  onSelect,
}: MessageListProps) {
  const [query, setQuery] = useState('')

  // A search belongs to the folder it was typed in. App keys this component
  // by folder id, so switching folders remounts it and clears the query
  // without an effect chasing the prop.

  // One lowercase pass per folder load instead of four per message on every
  // keystroke.
  const haystacks = useMemo(
    () =>
      messages.map((m) =>
        `${m.subject}\n${m.fromName}\n${m.fromEmail}\n${m.preview}`.toLowerCase()
      ),
    [messages]
  )

  // Keeps typing responsive on very large folders: React renders the input
  // immediately and the filtered list catches up.
  const deferredQuery = useDeferredValue(query)

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return messages
    return messages.filter((_, i) => haystacks[i].includes(q))
  }, [messages, haystacks, deferredQuery])

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
      ) : error ? (
        <div className="pane-status pane-status--error">
          <AlertIcon width={16} height={16} />
          <span>{error}</span>
        </div>
      ) : (
        <VirtualList
          items={filtered}
          rowHeight={72}
          getKey={(m) => m.id}
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
