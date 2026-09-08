/// <reference lib="webworker" />
/**
 * Low-level, per-row header reads used only by the background indexer
 * (backgroundIndexer.ts) — never by folder listing, which keeps
 * materializing full PSTMessage objects exactly as it always has. This is
 * deliberate: an earlier branch made folder listing itself read rows this
 * way and, because that never materializes a full message list, broke
 * search entirely. This time the fast read only feeds an index that makes
 * search *faster*, and normal browsing is completely unaffected by it.
 *
 * A folder's contents table (a Table Context, the same structure Outlook
 * reads to paint a message list) already carries subject, sender,
 * recipients, delivery time and the read/attachment flags as columns.
 * pst-extractor builds that table with an "extract only this column"
 * filter pinned to PidTagLtpRowId (0x67F2) and discards the rest — see
 * PSTFolder.initEmailsTable(). Building it without that filter and
 * reading the columns directly costs ~0.06 ms and ~165 bytes per row,
 * versus ~0.96 ms and ~22 KB for constructing a full PSTMessage — the
 * difference between indexing a folder in the background being
 * reasonable and not.
 *
 * ── Coupling warning ────────────────────────────────────────────────────
 * This module reaches past pst-extractor's public API into PSTTable7C and
 * PSTNodeInputStream. pst-extractor is pinned to an exact version for that
 * reason, and `assertHeaderIndexViable()` fails loudly rather than letting
 * a changed internal silently index wrong or empty data.
 */
import type { Buffer } from 'buffer'
import Long from 'long'
import type { PSTFile, PSTFolder } from 'pst-extractor'
import { PSTNodeInputStream } from 'pst-extractor/dist/PSTNodeInputStream.class'
import { PSTTable7C } from 'pst-extractor/dist/PSTTable7C.class'
import { PSTUtil } from 'pst-extractor/dist/PSTUtil.class'

/** MAPI property tags present as columns in a folder contents table. */
const TAG = {
  SUBJECT: 0x0037,
  SENT_REPRESENTING_NAME: 0x0042,
  DISPLAY_TO: 0x0e04,
  DISPLAY_CC: 0x0e03,
  MESSAGE_DELIVERY_TIME: 0x0e06,
  LTP_ROW_ID: 0x67f2,
} as const

interface RowItem {
  data: Buffer
  entryValueReference: number
  getStringValue(): string
}
type Row = Map<number, RowItem>

export interface FolderTable {
  table: PSTTable7C
  rowCount: number
}

export interface HeaderRow {
  /** The message's descriptor id — the same value PSTMessage.descriptorNodeId
   * would give, so it can be opened directly later without needing its
   * parent folder materialized first. */
  id: string
  subject: string
  fromName: string
  toDisplay: string
  ccDisplay: string
  /** ISO string, or null if undecodable/absent. */
  date: string | null
}

/** Builds the folder's contents table with every column intact — repeats
 * PSTFolder.initEmailsTable() minus the single-column filter it passes as
 * the constructor's third argument. */
export function openFolderTable(pstFile: PSTFile, folder: PSTFolder): FolderTable {
  const descriptorNode = (
    folder as unknown as { descriptorIndexNode: { descriptorIdentifier: number } }
  ).descriptorIndexNode
  if (!descriptorNode) throw new Error('Folder has no descriptor node')

  const contentsId = descriptorNode.descriptorIdentifier + 12
  const contentsDescriptor = pstFile.getDescriptorIndexNode(Long.fromNumber(contentsId))

  let localDescriptors
  if (contentsDescriptor.localDescriptorsOffsetIndexIdentifier.greaterThan(0)) {
    localDescriptors = pstFile.getPSTDescriptorItems(
      contentsDescriptor.localDescriptorsOffsetIndexIdentifier
    )
  }
  const offsetItem = pstFile.getOffsetIndexNode(contentsDescriptor.dataOffsetIndexIdentifier)
  const stream = new PSTNodeInputStream(pstFile, offsetItem)

  const table = new PSTTable7C(stream, localDescriptors) // no 3rd argument
  return { table, rowCount: table.rowCount }
}

/** Reads and decodes a window of rows. Cost scales with `limit`, not with
 * folder size — the underlying getItems() seeks by arithmetic. */
export function readHeaderRows(folderTable: FolderTable, offset: number, limit: number): HeaderRow[] {
  const available = Math.max(0, folderTable.rowCount - offset)
  const count = Math.min(limit, available)
  if (count <= 0) return []
  const rows = folderTable.table.getItems(offset, count) as unknown as Row[]
  return rows.map(toHeaderRow)
}

function str(row: Row, tag: number): string {
  const item = row.get(tag)
  if (!item) return ''
  try {
    return (item.getStringValue() ?? '').trim()
  } catch {
    return ''
  }
}

/** PidTagSubject carries a two-character prefix marker: when the first
 * character is 0x01, the real subject starts at index 2 (the marker
 * encodes the length of a stripped "RE: "/"FW: " prefix). Reproduces what
 * PSTMessage.subject does, since reading the raw column does not. */
function decodeSubject(raw: string): string {
  if (raw.length >= 2 && raw.charCodeAt(0) === 0x01) {
    return raw.length === 2 ? '' : raw.substring(2)
  }
  return raw
}

/** PidTagMessageDeliveryTime is PT_SYSTIME: an 8-byte Windows FILETIME
 * landing in `item.data` rather than in `entryValueReference`. */
function decodeTime(row: Row, tag: number): string | null {
  const item = row.get(tag)
  if (!item || !item.data || item.data.length < 8) return null
  try {
    const buf = item.data
    const hi = PSTUtil.convertLittleEndianBytesToLong(buf, 4, 8)
    const low = PSTUtil.convertLittleEndianBytesToLong(buf, 0, 4)
    const date = PSTUtil.filetimeToDate(hi, low)
    if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return null
    return date.toISOString()
  } catch {
    return null
  }
}

function toHeaderRow(row: Row): HeaderRow {
  const idItem = row.get(TAG.LTP_ROW_ID)
  return {
    id: String(idItem?.entryValueReference ?? ''),
    subject: decodeSubject(str(row, TAG.SUBJECT)),
    fromName: str(row, TAG.SENT_REPRESENTING_NAME),
    toDisplay: str(row, TAG.DISPLAY_TO),
    ccDisplay: str(row, TAG.DISPLAY_CC),
    date: decodeTime(row, TAG.MESSAGE_DELIVERY_TIME),
  }
}

/**
 * Fails loudly if pst-extractor's internals have moved under us, rather
 * than silently indexing nothing or garbage — the worst failure mode for a
 * feature whose entire job is "find things reliably".
 */
export function assertHeaderIndexViable(folderTable: FolderTable): void {
  if (folderTable.rowCount === 0) return // Empty folder proves nothing; allow it.
  const rows = folderTable.table.getItems(0, 1) as unknown as Row[]
  const row = rows?.[0]
  if (!row || typeof row.get !== 'function') {
    throw new Error(
      'Background indexing unavailable: contents table rows are no longer a Map keyed by ' +
        'property tag. This build pins pst-extractor to an exact version for this reason.'
    )
  }
  if (!row.has(TAG.LTP_ROW_ID)) {
    throw new Error('Background indexing unavailable: contents table row is missing PidTagLtpRowId.')
  }
  if (row.size <= 1) {
    throw new Error(
      'Background indexing unavailable: contents table returned only the row-id column — the ' +
        'single-column filter appears to still be applied.'
    )
  }
}
