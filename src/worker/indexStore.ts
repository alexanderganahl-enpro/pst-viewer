/// <reference lib="webworker" />
/**
 * Persists the header index in IndexedDB so reopening the same file skips
 * re-indexing entirely, keyed per folder so an interrupted session resumes
 * for free: a folder already in the store is loaded instead of re-read,
 * whatever folders remain just pick up where they left off.
 *
 * This is derived content from the user's own mail sitting in browser
 * storage. It never leaves the browser (same `connect-src 'none'` CSP
 * guarantee as everything else here) but it is disclosed explicitly in the
 * indexing panel, with a one-click way to delete it — see
 * IndexProgress.tsx. Nothing about this weakens the "your file never
 * leaves this tab" claim; it only affects what's cached *inside* the tab's
 * own storage, for this origin only.
 */
import type { PersistedFolderIndex } from './folderIndex'

const DB_NAME = 'pst-viewer-index'
const DB_VERSION = 1
const STORE = 'folderIndexes'

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Opens (or creates) the database. Resolves to null rather than
 * rejecting if IndexedDB is unavailable — private windows, blocked site
 * data, or a browser that doesn't expose it in a worker — since caching is
 * an optimization, not a requirement for the app to function. */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        // Keyed by [fingerprint, folderId] so folders from different files
        // (or a re-fingerprinted, changed copy of the same file) never
        // collide, and one file's folders can be range-queried together.
        db.createObjectStore(STORE, { keyPath: ['fingerprint', 'folderId'] })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

/** A cheap fingerprint, not a content hash: file size plus the browser's
 * reported last-modified time. Good enough to invalidate the cache whenever
 * the file has plausibly changed, and cheap enough to compute with nothing
 * more than what the 'open' request already carries. */
export function computeFingerprint(fileSize: number, lastModified: number): string {
  return `${fileSize}:${lastModified}`
}

export async function loadFolderIndex(
  fingerprint: string,
  folderId: string
): Promise<PersistedFolderIndex | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get([fingerprint, folderId])
      req.onsuccess = () => resolve((req.result as PersistedFolderIndex | undefined) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function saveFolderIndex(
  fingerprint: string,
  index: PersistedFolderIndex
): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ ...index, fingerprint })
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve() // Best-effort — a failed write just means no cache next time.
    } catch {
      resolve()
    }
  })
}

/** Deletes every folder record for one file. Used by the "Clear cached
 * index" control — an explicit, user-initiated action, never automatic. */
export async function clearFingerprint(fingerprint: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const range = IDBKeyRange.bound([fingerprint, ''], [fingerprint, '￿'])
      store.delete(range)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
