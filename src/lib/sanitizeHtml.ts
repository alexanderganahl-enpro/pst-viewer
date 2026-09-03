import DOMPurify from 'dompurify'

let hooksInstalled = false

function installHooks() {
  if (hooksInstalled) return
  hooksInstalled = true
  // Any link in a message body opens in a new tab rather than navigating
  // the sandboxed preview iframe.
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

/** Sanitizes an email HTML body for display. Defense-in-depth: the result
 * is still only ever rendered inside a sandboxed, scriptless iframe. */
export function sanitizeEmailHtml(html: string): string {
  installHooks()
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    // Rendered inside a sandboxed, scriptless iframe, so a <style> block is
    // safe to keep (it cannot escape the iframe) and email bodies often
    // depend on one for layout.
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  })
}
