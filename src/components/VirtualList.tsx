import { useRef, useState, type ReactNode, type UIEvent } from 'react'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  overscan?: number
  renderRow: (item: T, index: number) => ReactNode
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
  emptyState,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  const handleRef = (node: HTMLDivElement | null) => {
    containerRef.current = node
    if (node) setViewportHeight(node.clientHeight)
  }

  if (items.length === 0 && emptyState) {
    return (
      <div className="virtual-list" ref={handleRef}>
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
    <div className="virtual-list" ref={handleRef} onScroll={onScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: firstIndex * rowHeight, left: 0, right: 0 }}>
          {visible.map((item, i) => (
            <div key={firstIndex + i} style={{ height: rowHeight }}>
              {renderRow(item, firstIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
