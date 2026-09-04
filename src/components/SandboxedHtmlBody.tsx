import { useEffect, useMemo, useRef, useState } from 'react'
import { sanitizeEmailHtml } from '../lib/sanitizeHtml'
import { AlertIcon } from './Icons'

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
  [data-blocked-remote]{
    display:inline-block;min-width:16px;min-height:16px;
    border:1px dashed #c7c7c7;border-radius:3px;background:#f5f5f5;
  }
`

/**
 * The privacy control that makes this app's "nothing leaves this tab" claim
 * actually true rather than aspirational.
 *
 * `default-src 'none'` means the message body cannot fetch *anything* —
 * no tracking pixels, no remote CSS, no webfonts, no beacons. `img-src
 * data: cid:` still allows genuinely local inline images. Verified in a real
 * browser: without this, an <img> pointing at a remote host completes a
 * network round trip; with it, the load is blocked and a
 * securitypolicyviolation fires instead.
 *
 * When the user explicitly opts in to remote content for a message, images
 * and media are permitted — but scripts, frames, and (critically)
 * connect-src stay denied, so even then a body can't open a socket or
 * exfiltrate via fetch.
 */
function buildCsp(allowRemote: boolean): string {
  const img = allowRemote ? 'data: cid: https: http:' : 'data: cid:'
  const media = allowRemote ? 'data: https: http:' : "'none'"
  return [
    "default-src 'none'",
    `img-src ${img}`,
    `media-src ${media}`,
    "style-src 'unsafe-inline'",
    'font-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/** Renders a message's HTML body inside a sandboxed iframe with no script
 * execution capability and a strict CSP, so a crafted email body can neither
 * run JS nor phone home — it can only display. */
export function SandboxedHtmlBody({ html }: SandboxedHtmlBodyProps) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(200)
  const [allowRemote, setAllowRemote] = useState(false)

  // A different message means a fresh decision — never carry an opt-in over
  // from the previously-viewed message. Adjusted during render (React's
  // documented pattern for resetting state on a prop change) rather than in
  // an effect, so there's no frame where the new message is rendered with
  // the old message's permission.
  const [renderedHtml, setRenderedHtml] = useState(html)
  if (renderedHtml !== html) {
    setRenderedHtml(html)
    setAllowRemote(false)
  }

  const { srcDoc, blockedRemoteCount } = useMemo(() => {
    const { html: clean, blockedRemoteCount } = sanitizeEmailHtml(html, allowRemote)
    const csp = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(allowRemote)}">`
    return {
      srcDoc: `<!doctype html><html><head><meta charset="utf-8">${csp}<style>${FRAME_STYLE}</style></head><body>${clean}</body></html>`,
      blockedRemoteCount,
    }
  }, [html, allowRemote])

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
    <>
      {blockedRemoteCount > 0 && (
        <div className="remote-content-banner">
          <AlertIcon width={16} height={16} />
          <span>
            Remote content blocked ({blockedRemoteCount}
            {blockedRemoteCount === 1 ? ' item' : ' items'}). Loading it would tell the sender
            you opened this message.
          </span>
          <button type="button" onClick={() => setAllowRemote(true)}>
            Show content
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        title="Message body"
        className="message-body-frame"
        srcDoc={srcDoc}
        // No allow-scripts: nothing in an email body can execute JS, even
        // with allow-same-origin present alongside it (which is only there
        // so we can measure content height to size the frame).
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{ height }}
      />
    </>
  )
}
