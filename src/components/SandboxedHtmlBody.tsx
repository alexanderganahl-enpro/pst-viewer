import { useEffect, useRef, useState } from 'react'
import { sanitizeEmailHtml } from '../lib/sanitizeHtml'

interface SandboxedHtmlBodyProps {
  html: string
}

const FRAME_STYLE = `
  html,body{margin:0;padding:0}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    font-size:14px;
    color:#242424;
    padding:16px;
    word-wrap:break-word;
    overflow-wrap:anywhere;
  }
  img{max-width:100%;height:auto}
  table{max-width:100%}
`

/** Renders a message's HTML body inside a sandboxed iframe with no script
 * execution capability, so a crafted email body can't run JS or reach the
 * app around it — it can only display. */
export function SandboxedHtmlBody({ html }: SandboxedHtmlBodyProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_STYLE}</style></head><body>${sanitizeEmailHtml(
    html
  )}</body></html>`

  useEffect(() => {
    const frame = ref.current
    if (!frame) return
    const onLoad = () => {
      try {
        const doc = frame.contentDocument
        if (doc) setHeight(Math.max(120, doc.documentElement.scrollHeight + 24))
      } catch {
        // Cross-origin access denied — keep the previous height.
      }
    }
    frame.addEventListener('load', onLoad)
    return () => frame.removeEventListener('load', onLoad)
  }, [srcDoc])

  return (
    <iframe
      ref={ref}
      title="Message body"
      className="message-body-frame"
      srcDoc={srcDoc}
      // No allow-scripts: nothing in an email body can execute JS, even
      // with allow-same-origin present alongside it.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ height }}
    />
  )
}
