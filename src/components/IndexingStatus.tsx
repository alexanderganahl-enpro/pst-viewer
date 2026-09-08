import { useState } from 'react'
import type { IndexProgress } from '../types'
import { AlertIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, PauseIcon, PlayIcon } from './Icons'

interface IndexingStatusProps {
  progress: IndexProgress
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onClearCache: () => void
}

const STATE_LABEL: Record<IndexProgress['state'], string> = {
  running: 'Indexing for search…',
  paused: 'Indexing paused',
  done: 'All folders indexed',
  capped: 'Search index limit reached',
  stopped: 'Indexing skipped',
  idle: 'Indexing not started',
}

/** Bar + expandable detail showing background header-indexing progress —
 * see src/worker/backgroundIndexer.ts. Never blocks browsing: this is just
 * a status readout for a worker task that's already running on its own. */
export function IndexingStatus({ progress, onPause, onResume, onStop, onClearCache }: IndexingStatusProps) {
  const [expanded, setExpanded] = useState(false)
  const { totalMessages, indexedMessages, foldersTotal, foldersDone, currentFolderName, state } = progress

  if (state === 'idle') return null

  const pct = totalMessages > 0 ? Math.min(100, Math.round((indexedMessages / totalMessages) * 100)) : 0
  const settled = state === 'done' || state === 'capped' || state === 'stopped'

  return (
    <div className={`indexing-status indexing-status--${state}`}>
      <button
        type="button"
        className="indexing-status__summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDownIcon width={14} height={14} /> : <ChevronRightIcon width={14} height={14} />}
        {settled ? (
          state === 'done' ? (
            <CheckIcon width={14} height={14} className="indexing-status__icon" />
          ) : (
            <AlertIcon width={14} height={14} className="indexing-status__icon" />
          )
        ) : (
          <span className="indexing-status__spinner" aria-hidden="true" />
        )}
        <span className="indexing-status__label">{STATE_LABEL[state]}</span>
        {!settled && (
          <span className="indexing-status__count">
            {indexedMessages.toLocaleString()} / {totalMessages.toLocaleString()}
          </span>
        )}
        <span className="indexing-status__bar-track">
          <span className="indexing-status__bar-fill" style={{ width: `${pct}%` }} />
        </span>
      </button>

      {expanded && (
        <div className="indexing-status__detail">
          <dl className="indexing-status__stats">
            <div>
              <dt>Messages indexed</dt>
              <dd>
                {indexedMessages.toLocaleString()} / {totalMessages.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>Folders done</dt>
              <dd>
                {foldersDone.toLocaleString()} / {foldersTotal.toLocaleString()}
              </dd>
            </div>
            {!settled && currentFolderName && (
              <div>
                <dt>Current folder</dt>
                <dd>{currentFolderName}</dd>
              </div>
            )}
          </dl>

          {state === 'capped' && (
            <p className="indexing-status__note">
              This archive is large enough that indexing stopped early to avoid using too much memory. Archive
              search covers only what was indexed above — folders indexed first are fully covered, the rest
              are not.
            </p>
          )}
          {state === 'stopped' && (
            <p className="indexing-status__note">
              Indexing was skipped. Archive search only covers what got indexed before that. Browsing folders
              is unaffected either way.
            </p>
          )}

          <div className="indexing-status__actions">
            {state === 'running' && (
              <button type="button" className="btn btn--subtle" onClick={onPause}>
                <PauseIcon width={14} height={14} />
                Pause
              </button>
            )}
            {state === 'paused' && (
              <button type="button" className="btn btn--subtle" onClick={onResume}>
                <PlayIcon width={14} height={14} />
                Resume
              </button>
            )}
            {(state === 'running' || state === 'paused') && (
              <button type="button" className="btn btn--subtle" onClick={onStop}>
                Skip indexing
              </button>
            )}
            <button type="button" className="btn btn--subtle" onClick={onClearCache}>
              Clear cached index
            </button>
          </div>
          <p className="indexing-status__disclosure">
            The search index (subjects, senders, recipients — never message bodies) is cached in this
            browser tab's local storage so reopening this file skips re-indexing. It never leaves your
            device.
          </p>
        </div>
      )}
    </div>
  )
}
