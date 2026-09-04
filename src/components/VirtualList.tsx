import { useEffect, useState, type ReactNode, type UIEvent } from 'react'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  overscan?: number
  renderRow: (item: T, index: number) => ReactNode
  /** Stable identity for a row. Falling back to the index means React
   * reuses a row's DOM for whatever item scrolls into that slot, which goes
   * wrong as soon as the item set changes underneath (e.g. filtering). */
  getKey?: (item: T, index: number) => string | number
  emptyState?: ReactNode
}

/** Minimal fixed-row-height virtualizer, dependency-free. PST folders can
 * hold tens of thousands of messages; this keeps the message list snappy
 * without pulling in a virtualization library. */
export function VirtualList<T>({
  items,
  rowHeight,
  overscan = 6,
  renderRow,
  getKey,
  emptyState,
}: VirtualListProps<T>) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  // Measure via ResizeObserver rather than at render time: the previous
  // approach only re-measured when something else caused a render, so
  // resizing the window without scrolling left the visible-row count stale
  // (blank space at the bottom, or rows rendered needlessly).
  useEffect(() => {
    if (!container) return
    // ResizeObserver fires once immediately on observe(), so this covers
    // the initial measurement too — no separate synchronous set needed.
    const observer = new ResizeObserver(() => setViewportHeight(container.clientHeight))
    observer.observe(container)
    return () => observer.disconnect()
  }, [container])

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  if (items.length === 0 && emptyState) {
    return (
      <div className="virtual-list" ref={setContainer}>
        {emptyState}
      </div>
    )
  }

  const totalHeight = items.length * rowHeight
  const firstIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const lastIndex = Math.min(items.length, firstIndex + visibleCount)

  const visible = items.slice(firstIndex, lastIndex)

  return (
    <div className="virtual-list" ref={setContainer} onScroll={onScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: firstIndex * rowHeight, left: 0, right: 0 }}>
          {visible.map((item, i) => {
            const index = firstIndex + i
            return (
              <div key={getKey ? getKey(item, index) : index} style={{ height: rowHeight }}>
                {renderRow(item, index)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
