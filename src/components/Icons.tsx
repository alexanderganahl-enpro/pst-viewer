import type { SVGProps } from 'react'

/** Small inline Fluent-style icon set (20x20, stroke = currentColor).
 *  Kept as plain inline SVG so the app has zero icon-font / icon-library
 *  dependency and works fully offline. */

type IconProps = SVGProps<SVGSVGElement>

const base: IconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="4.5" width="16" height="11" rx="1.6" />
      <path d="M3 5.5l7 5.5 7-5.5" />
    </svg>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 5.2c0-.66.54-1.2 1.2-1.2h3.4l1.4 1.6h7.3c.66 0 1.2.54 1.2 1.2v7.8c0 .66-.54 1.2-1.2 1.2H3.7c-.66 0-1.2-.54-1.2-1.2z" />
    </svg>
  )
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2.5 6.4c0-.66.54-1.2 1.2-1.2h3.4l1.4 1.4h6.3c.66 0 1.2.54 1.2 1.2v.6H4.7L2.9 14.4" />
      <path d="M2.9 14.4l1.6-5.4c.15-.5.6-.8 1.1-.8h10.9c.75 0 1.28.72 1.06 1.44l-1.5 4.76c-.15.5-.6.8-1.1.8H4c-.55 0-1-.45-1-1z" />
    </svg>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7.5 4.5l6 5.5-6 5.5" />
    </svg>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 7.5l5.5 6 5.5-6" />
    </svg>
  )
}

export function PaperclipIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M13.7 5.3l-7 7a2.6 2.6 0 003.7 3.7l6.6-6.6a4 4 0 00-5.7-5.7l-6.6 6.6a5.5 5.5 0 007.8 7.8" />
    </svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3v10" />
      <path d="M5.5 8.5L10 13l4.5-4.5" />
      <path d="M3.5 16h13" />
    </svg>
  )
}

export function OpenFileIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 6.5c0-.83.67-1.5 1.5-1.5H8l1.8 1.8h5.7c.83 0 1.5.67 1.5 1.5v6.2c0 .83-.67 1.5-1.5 1.5h-11C3.67 16 3 15.33 3 14.5z" />
      <path d="M10 8.5v4" />
      <path d="M8.2 10.3L10 8.5l1.8 1.8" />
    </svg>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13.2 13.2L17.5 17.5" />
    </svg>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4.5" y="9" width="11" height="8" rx="1.4" />
      <path d="M6.5 9V6.5a3.5 3.5 0 017 0V9" />
    </svg>
  )
}

export function InboxIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 11l2.2-6.2A1.5 1.5 0 016.6 4h6.8c.65 0 1.23.41 1.44 1.02L17 11" />
      <path d="M3 11v3.5C3 15.33 3.67 16 4.5 16h11c.83 0 1.5-.67 1.5-1.5V11h-4.2l-.9 1.8H8.6L7.7 11z" />
    </svg>
  )
}

export function PersonIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="10" cy="6.8" r="3.3" />
      <path d="M3.5 17c.9-3.4 3.6-5.2 6.5-5.2S15.6 13.6 16.5 17" />
    </svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3l8.2 14H1.8z" />
      <path d="M10 8.3v3.8" />
      <circle cx="10" cy="14.6" r="0.15" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6.5 4.5v11" />
      <path d="M13.5 4.5v11" />
    </svg>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M6 4.2v11.6l9-5.8z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  )
}
