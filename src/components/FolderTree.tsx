import { useState } from 'react'
import type { FolderNode } from '../types'
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, MailIcon } from './Icons'

interface FolderTreeProps {
  root: FolderNode
  selectedId: string | null
  onSelect: (folder: FolderNode) => void
}

export function FolderTree({ root, selectedId, onSelect }: FolderTreeProps) {
  return (
    <nav className="folder-tree" aria-label="Folders">
      <FolderTreeNode node={root} depth={0} selectedId={selectedId} onSelect={onSelect} isRoot />
    </nav>
  )
}

function FolderTreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  isRoot,
}: {
  node: FolderNode
  depth: number
  selectedId: string | null
  onSelect: (folder: FolderNode) => void
  isRoot?: boolean
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  return (
    <div>
      <button
        type="button"
        className={`folder-row${isSelected ? ' folder-row--selected' : ''}`}
        style={{ paddingLeft: 10 + depth * 16 }}
        onClick={() => {
          onSelect(node)
          if (hasChildren) setExpanded(true)
        }}
      >
        <span
          className={`folder-chevron${hasChildren ? '' : ' folder-chevron--hidden'}`}
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
        >
          {hasChildren && (expanded ? <ChevronDownIcon width={14} height={14} /> : <ChevronRightIcon width={14} height={14} />)}
        </span>
        <span className="folder-icon">
          {isRoot ? (
            <MailIcon width={16} height={16} />
          ) : expanded && hasChildren ? (
            <FolderOpenIcon width={16} height={16} />
          ) : (
            <FolderIcon width={16} height={16} />
          )}
        </span>
        <span className="folder-name">{node.name}</span>
        {node.unreadCount > 0 && <span className="folder-unread">{node.unreadCount}</span>}
      </button>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}
