import type { HeaderRow } from './headerIndex'

/**
 * One folder's searchable header index: struct-of-arrays rather than an
 * array of row objects, which matters at the sizes this is built for — a
 * million-row folder as row objects is a million small allocations for the
 * GC to track, versus a handful of large, contiguous arrays.
 *
 * Search itself is `String.indexOf` over one big lowercased blob with
 * `\n`-separated rows, rather than per-row substring checks — a single
 * native scan beats a JS loop calling `.includes()` a million times, and
 * it is what makes re-querying on every keystroke viable.
 */
export class FolderIndex {
  readonly ids: string[] = []
  readonly subjects: string[] = []
  readonly fromNames: string[] = []
  readonly dates: (string | null)[] = []

  readonly folderId: string
  readonly folderName: string
  readonly total: number

  private searchParts: string[] = []
  private offsets: number[] = [0]
  private blobCache: string | null = null

  constructor(folderId: string, folderName: string, total: number) {
    this.folderId = folderId
    this.folderName = folderName
    this.total = total
  }

  get indexedCount(): number {
    return this.ids.length
  }

  get complete(): boolean {
    return this.indexedCount >= this.total
  }

  addRow(row: HeaderRow): void {
    this.ids.push(row.id)
    this.subjects.push(row.subject || '(No subject)')
    this.fromNames.push(row.fromName)
    this.dates.push(row.date)

    const text = `${row.subject}\n${row.fromName}\n${row.toDisplay}\n${row.ccDisplay}`.toLowerCase()
    this.searchParts.push(text)
    this.offsets.push(this.offsets[this.offsets.length - 1] + text.length + 1)
    this.blobCache = null // invalidate; rebuilt lazily on next search
  }

  private blob(): string {
    if (this.blobCache === null) this.blobCache = this.searchParts.join('\n')
    return this.blobCache
  }

  /** Binary search for the row whose span contains byte offset `pos`. */
  private rowAtOffset(pos: number): number {
    let lo = 0
    let hi = this.offsets.length - 2 // last real row index
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.offsets[mid] <= pos) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** Row indices matching `query`, up to `limit`. Case-insensitive
   * regardless of what the caller passes — lowercased here, not left as a
   * contract callers have to remember, since getting that wrong doesn't
   * error, it just silently returns no matches. Most recent first isn't
   * guaranteed; callers sort. */
  search(query: string, limit: number): number[] {
    const queryLower = query.toLowerCase()
    if (!queryLower || this.indexedCount === 0) return []
    const blob = this.blob()
    const matches: number[] = []
    const seen = new Set<number>()
    let pos = blob.indexOf(queryLower)
    while (pos !== -1 && matches.length < limit) {
      const row = this.rowAtOffset(pos)
      if (!seen.has(row)) {
        seen.add(row)
        matches.push(row)
      }
      pos = blob.indexOf(queryLower, pos + queryLower.length)
    }
    return matches
  }

  /** For IndexedDB persistence: everything needed to reconstruct this index
   * without re-reading the PST. */
  toPersisted(): PersistedFolderIndex {
    return {
      folderId: this.folderId,
      folderName: this.folderName,
      total: this.total,
      ids: this.ids,
      subjects: this.subjects,
      fromNames: this.fromNames,
      dates: this.dates,
      searchParts: this.searchParts,
    }
  }

  static fromPersisted(p: PersistedFolderIndex): FolderIndex {
    const idx = new FolderIndex(p.folderId, p.folderName, p.total)
    idx.ids.push(...p.ids)
    idx.subjects.push(...p.subjects)
    idx.fromNames.push(...p.fromNames)
    idx.dates.push(...p.dates)
    idx.searchParts = p.searchParts
    idx.offsets = [0]
    for (const part of p.searchParts) {
      idx.offsets.push(idx.offsets[idx.offsets.length - 1] + part.length + 1)
    }
    return idx
  }
}

/** The plain-data shape stored in IndexedDB — see indexStore.ts. */
export interface PersistedFolderIndex {
  folderId: string
  folderName: string
  total: number
  ids: string[]
  subjects: string[]
  fromNames: string[]
  dates: (string | null)[]
  searchParts: string[]
}
