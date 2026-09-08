import { useEffect, useMemo, useRef, useState } from 'react'
import type { SearchHit } from '../types'
import { AlertIcon, CloseIcon, FolderIcon, SearchIcon } from './Icons'

interface ArchiveSearchProps {
  onSearch: (query: string) => Promise<SearchHit[]>
  onSelectHit: (hit: SearchHit) => void
  onClose: () => void
  /** Whether the background index has any coverage yet — search still works
   * with partial coverage, this just sets expectations. */
  indexedMessages: number
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Archive-wide search over the background header index (see
 * backgroundIndexer.ts). Results resolve to real messages: selecting one
 * hands the folder + message id back to App, which loads it through the
 * same, unchanged getMessage() path a normal click would use. */
export function ArchiveSearch({ onSearch, onSelectHit, onClose, indexedMessages }: ArchiveSearchProps) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      // Nothing to debounce for an empty query — clearing the field is
      // handled directly in the input's onChange instead of here, so this
      // effect only ever fires setState for an actual search.
      return
    }
    const id = ++requestId.current
    const timer = setTimeout(() => {
      onSearch(q)
        .then((results) => {
          if (requestId.current !== id) return
          setHits(results)
          setSearched(true)
          setError(null)
        })
        .catch((err) => {
          if (requestId.current !== id) return
          setError(err instanceof Error ? err.message : 'Search failed.')
          setSearched(true)
        })
    }, 150)
    return () => clearTimeout(timer)
  }, [query, onSearch])

  const grouped = useMemo(() => {
    const byFolder = new Map<string, { folderName: string; hits: SearchHit[] }>()
    for (const hit of hits) {
      const entry = byFolder.get(hit.folderId)
      if (entry) entry.hits.push(hit)
      else byFolder.set(hit.folderId, { folderName: hit.folderName, hits: [hit] })
    }
    return Array.from(byFolder.values())
  }, [hits])

  return (
    <div className="archive-search-overlay" onClick={onClose}>
      <div className="archive-search" onClick={(e) => e.stopPropagation()}>
        <div className="archive-search__header">
          <div className="search-box archive-search__box">
            <SearchIcon width={16} height={16} />
            <input
              ref={inputRef}
              type="text"
              placeholder={`Search all mail${indexedMessages > 0 ? ` (${indexedMessages.toLocaleString()} indexed)` : ''}`}
              value={query}
              onChange={(e) => {
                const next = e.target.value
                setQuery(next)
                if (!next.trim()) {
                  requestId.current++ // invalidate any in-flight search
                  setHits([])
                  setSearched(false)
                  setError(null)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
          <button type="button" className="archive-search__close" onClick={onClose} title="Close search">
            <CloseIcon width={16} height={16} />
          </button>
        </div>

        <div className="archive-search__results">
          {error ? (
            <div className="pane-status pane-status--error">
              <AlertIcon width={16} height={16} />
              <span>{error}</span>
            </div>
          ) : !query.trim() ? (
            <div className="pane-status">
              Search across every folder in this file, by subject, sender, or recipient — powered by the
              background index.
            </div>
          ) : !searched ? (
            <div className="pane-status">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="pane-status">No messages match “{query.trim()}”.</div>
          ) : (
            grouped.map((group) => (
              <div key={group.folderName + group.hits[0].folderId} className="archive-search__group">
                <div className="archive-search__group-header">
                  <FolderIcon width={14} height={14} />
                  {group.folderName}
                </div>
                {group.hits.map((hit) => (
                  <button
                    type="button"
                    key={`${hit.folderId}:${hit.messageId}`}
                    className="archive-search__hit"
                    onClick={() => onSelectHit(hit)}
                  >
                    <span className="archive-search__hit-top">
                      <span className="archive-search__hit-from">{hit.fromName || 'Unknown sender'}</span>
                      <span className="archive-search__hit-date">{formatDate(hit.date)}</span>
                    </span>
                    <span className="archive-search__hit-subject">{hit.subject || '(No subject)'}</span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
