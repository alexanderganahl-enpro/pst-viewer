import createDOMPurify from 'dompurify'

/** Attributes that can pull down a remote subresource just by existing. */
const REMOTE_URL_ATTRS = ['src', 'srcset', 'poster', 'background', 'xlink:href'] as const

/** A URL that would cause the browser to reach out to the network.
 * `data:` and `cid:` are local and always allowed; everything with a scheme
 * or a protocol-relative prefix is treated as remote. */
function isRemoteUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (/^(data|cid|blob):/i.test(v)) return false
  return /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')
}

// sanitize() is synchronous, so a module-level context set immediately
// before the call is safe.
let ctx = { allowRemote: false, blocked: 0 }
let purifier: ReturnType<typeof createDOMPurify> | null = null

/** Binds our own DOMPurify instance rather than mutating the shared default
 * export with hooks — the hooks below are specific to rendering email
 * bodies and shouldn't apply to any other use of DOMPurify. Bound lazily
 * because the default export only self-binds when a DOM already exists at
 * import time, which isn't true under a test runner. */
function getPurifier(): ReturnType<typeof createDOMPurify> {
  if (purifier) return purifier

  const instance = createDOMPurify(globalThis.window)
  if (!instance.isSupported) {
    throw new Error('HTML sanitization is unavailable in this environment')
  }

  instance.addHook('afterSanitizeAttributes', (node) => {
    // Any link in a message body opens in a new tab rather than navigating
    // the sandboxed preview iframe.
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }

    if (ctx.allowRemote) return

    // Strip attributes that would fetch remote content. This is the
    // user-visible half of the block; the iframe's CSP is the backstop that
    // also catches what this can't reach — CSS `url()`, `@import`, and
    // webfonts inside <style> blocks and style="" attributes.
    for (const attr of REMOTE_URL_ATTRS) {
      if (!node.hasAttribute?.(attr)) continue
      const value = node.getAttribute(attr) ?? ''
      if (!isRemoteUrl(value)) continue
      node.removeAttribute(attr)
      node.setAttribute('data-blocked-remote', '')
      ctx.blocked++
    }
  })

  purifier = instance
  return instance
}

export interface SanitizeResult {
  html: string
  /** How many remote references were stripped. Drives the "remote content
   * blocked" banner; 0 means there was nothing to block. */
  blockedRemoteCount: number
}

/**
 * Sanitizes an email HTML body for display inside the sandboxed preview
 * iframe.
 *
 * Two layers, deliberately:
 *  1. DOMPurify removes scripts and (unless `allowRemote`) any attribute
 *     that would fetch remote content — the tracking-pixel vector.
 *  2. The iframe itself carries a CSP (see SandboxedHtmlBody) which is what
 *     actually *enforces* the no-network guarantee, including for CSS
 *     `url()` and `@import` that attribute stripping can't see.
 */
export function sanitizeEmailHtml(html: string, allowRemote = false): SanitizeResult {
  const instance = getPurifier()
  ctx = { allowRemote, blocked: 0 }
  try {
    const clean = instance.sanitize(html, {
      // The result is injected into a <body> we build ourselves, so we want
      // a fragment — WHOLE_DOCUMENT would nest a second <html>/<body>.
      WHOLE_DOCUMENT: false,
      // DOMPurify already strips every on* handler; these are the tags whose
      // removal isn't about scripting — external stylesheets and embedded
      // objects/forms have no place in a local, read-only mail preview.
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta'],
    })
    return { html: clean, blockedRemoteCount: ctx.blocked }
  } finally {
    ctx = { allowRemote: false, blocked: 0 }
  }
}
