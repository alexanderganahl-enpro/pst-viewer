/**
 * Attachment names come from whoever wrote the message, not from the person
 * opening it, so these are security tests rather than formatting tests.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { sanitizeFilename } from '../sanitizeFilename'

const FALLBACK = 'attachment-1'

describe('sanitizeFilename', () => {
  test('strips right-to-left override used to disguise an extension', () => {
    // Renders as "invoiceexe.pdf" in most UIs but is really "...pdf.exe".
    const disguised = 'invoice\u202Efdp.exe'
    const out = sanitizeFilename(disguised, FALLBACK)
    assert.ok(!out.includes('\u202E'), 'bidi override must be removed')
    assert.equal(out, 'invoicefdp.exe', 'the true extension must survive visibly')
  })

  test('strips the full range of bidi and directional controls', () => {
    for (const ch of ['\u061C', '\u200E', '\u200F', '\u202A', '\u202D', '\u2066', '\u2069']) {
      const out = sanitizeFilename(`a${ch}b.txt`, FALLBACK)
      assert.equal(out, 'ab.txt', `U+${ch.codePointAt(0)!.toString(16)} must be stripped`)
    }
  })

  test('removes control characters including NUL and DEL', () => {
    assert.equal(sanitizeFilename('re\u0000port\u001F\u007F.txt', FALLBACK), 'report.txt')
  })

  test('reduces any path to its final segment', () => {
    assert.equal(sanitizeFilename('../../etc/passwd', FALLBACK), 'passwd')
    assert.equal(sanitizeFilename('C:\\Windows\\System32\\evil.dll', FALLBACK), 'evil.dll')
    assert.equal(sanitizeFilename('/absolute/path/report.pdf', FALLBACK), 'report.pdf')
  })

  test('neutralises traversal-only and empty names', () => {
    assert.equal(sanitizeFilename('..', FALLBACK), FALLBACK)
    assert.equal(sanitizeFilename('   ', FALLBACK), FALLBACK)
    assert.equal(sanitizeFilename('', FALLBACK), FALLBACK)
    assert.equal(sanitizeFilename('...', FALLBACK), FALLBACK)
  })

  test('escapes reserved Windows device names', () => {
    assert.equal(sanitizeFilename('CON', FALLBACK), '_CON')
    assert.equal(sanitizeFilename('lpt1.txt', FALLBACK), '_lpt1.txt')
    // Not reserved — only the exact device names are.
    assert.equal(sanitizeFilename('console.txt', FALLBACK), 'console.txt')
  })

  test('replaces characters that are illegal on common filesystems', () => {
    assert.equal(sanitizeFilename('a<b>c:d"e|f?g*h.txt', FALLBACK), 'a_b_c_d_e_f_g_h.txt')
  })

  test('drops leading dots and trailing dots/spaces', () => {
    assert.equal(sanitizeFilename('.hidden.txt', FALLBACK), 'hidden.txt')
    assert.equal(sanitizeFilename('report.txt.  ', FALLBACK), 'report.txt')
  })

  test('truncates very long names but keeps the extension', () => {
    const out = sanitizeFilename('a'.repeat(500) + '.pdf', FALLBACK)
    assert.ok(out.length <= 180, `expected <=180 chars, got ${out.length}`)
    assert.ok(out.endsWith('.pdf'), 'extension must be preserved through truncation')
  })

  test('leaves ordinary names untouched', () => {
    assert.equal(sanitizeFilename('Q3 Report (final).xlsx', FALLBACK), 'Q3 Report (final).xlsx')
    assert.equal(sanitizeFilename('résumé.pdf', FALLBACK), 'résumé.pdf')
  })
})
