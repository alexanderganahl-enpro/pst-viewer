/**
 * The sanitizer is the layer that stops an email body from phoning home,
 * so these are the app's most security-relevant tests.
 *
 * Two independent layers protect a message body, and this file covers the
 * first: attribute stripping. The second — the iframe's
 * `default-src 'none'` CSP, which also catches CSS `url()`/`@import` that
 * attribute stripping can't see — is enforced by the browser and verified
 * separately (see SandboxedHtmlBody.tsx).
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { JSDOM } from 'jsdom'

// DOMPurify binds to whatever `window` exists when it is imported, so the
// DOM has to be installed on globalThis first.
let sanitizeEmailHtml: typeof import('../sanitizeHtml').sanitizeEmailHtml

before(async () => {
  // jsdom specifically: DOMPurify targets it directly, and an emulator
  // that is merely close is worse than none — an earlier attempt with a
  // lighter DOM silently left <script> tags intact while stripping <p>,
  // which would have made these tests assert safety that was not there.
  const { window } = new JSDOM('')
  const g = globalThis as unknown as Record<string, unknown>
  g.window = window
  g.document = window.document
  ;({ sanitizeEmailHtml } = await import('../sanitizeHtml'))
})

describe('sanitizeEmailHtml — scripting', () => {
  test('removes script tags', () => {
    const { html } = sanitizeEmailHtml('<p>hi</p><script>fetch("//evil")</script>')
    assert.ok(!/<script/i.test(html))
    assert.ok(!html.includes('evil'))
  })

  test('removes inline event handlers', () => {
    const { html } = sanitizeEmailHtml('<img src="data:image/gif;base64,R0lGOD" onerror="alert(1)">')
    assert.ok(!/onerror/i.test(html))
  })

  test('removes javascript: URLs', () => {
    const { html } = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')
    assert.ok(!/javascript:/i.test(html))
  })

  test('removes nested frames and objects', () => {
    const { html } = sanitizeEmailHtml('<iframe src="//evil"></iframe><object data="//evil"></object>')
    assert.ok(!/<iframe|<object/i.test(html))
  })
})

describe('sanitizeEmailHtml — remote content (tracking pixels)', () => {
  test('strips a remote tracking pixel and counts it', () => {
    const result = sanitizeEmailHtml(
      '<img src="https://tracker.example.com/p.gif?id=abc123" width="1" height="1">'
    )
    assert.equal(result.blockedRemoteCount, 1)
    assert.ok(!result.html.includes('tracker.example.com'), 'tracker URL must not survive')
    assert.ok(result.html.includes('data-blocked-remote'), 'blocked element should be marked')
  })

  test('strips protocol-relative and http URLs too', () => {
    for (const url of ['//tracker.example.com/p.gif', 'http://tracker.example.com/p.gif']) {
      const result = sanitizeEmailHtml(`<img src="${url}">`)
      assert.equal(result.blockedRemoteCount, 1, `should block ${url}`)
      assert.ok(!result.html.includes('tracker.example.com'))
    }
  })

  test('strips remote references on other loading attributes', () => {
    const result = sanitizeEmailHtml(
      '<video poster="https://a.example/p.jpg"></video><table background="https://b.example/bg.png"></table>'
    )
    assert.equal(result.blockedRemoteCount, 2)
    assert.ok(!result.html.includes('a.example'))
    assert.ok(!result.html.includes('b.example'))
  })

  test('external stylesheets are dropped entirely', () => {
    const { html } = sanitizeEmailHtml('<link rel="stylesheet" href="https://evil.example/x.css">')
    assert.ok(!/<link/i.test(html))
    assert.ok(!html.includes('evil.example'))
  })

  test('keeps genuinely local inline images', () => {
    const result = sanitizeEmailHtml('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">')
    assert.equal(result.blockedRemoteCount, 0)
    assert.ok(result.html.includes('data:image/gif'), 'inline image must survive')
  })

  test('allows remote content only when explicitly opted in', () => {
    const url = 'https://tracker.example.com/p.gif'
    const blocked = sanitizeEmailHtml(`<img src="${url}">`, false)
    const allowed = sanitizeEmailHtml(`<img src="${url}">`, true)
    assert.equal(blocked.blockedRemoteCount, 1)
    assert.ok(!blocked.html.includes(url))
    assert.equal(allowed.blockedRemoteCount, 0)
    assert.ok(allowed.html.includes(url), 'opt-in must restore the image')
  })

  test('opt-in state does not leak between calls', () => {
    sanitizeEmailHtml('<img src="https://a.example/x.gif">', true)
    const next = sanitizeEmailHtml('<img src="https://b.example/x.gif">')
    assert.equal(next.blockedRemoteCount, 1, 'a later call must default back to blocking')
    assert.ok(!next.html.includes('b.example'))
  })
})

describe('sanitizeEmailHtml — links', () => {
  test('forces links to open in a new tab with noopener', () => {
    const { html } = sanitizeEmailHtml('<a href="https://example.com">x</a>')
    assert.ok(html.includes('target="_blank"'))
    assert.ok(html.includes('rel="noopener noreferrer"'))
  })

  test('returns a fragment, not a nested document', () => {
    const { html } = sanitizeEmailHtml('<p>hello</p>')
    assert.ok(!/<html|<body|<head/i.test(html), 'must not nest a second document')
  })
})
