/** Windows device names that can't be used as filenames, with or without an
 * extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** Bidirectional overrides/embeddings/isolates and directional marks:
 * U+061C, U+200E/200F, U+202A-202E (LRE/RLE/PDF/LRO/RLO),
 * U+2066-2069 (LRI/RLI/FSI/PDI). Written as escapes deliberately — these
 * are invisible, so a literal here would be unreviewable. */
const BIDI_CONTROLS = new RegExp(
  '[\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]',
  'g'
)

/** C0 and C1 control characters, including NUL and DEL. */
// Matching control characters is the entire point here: they are exactly
// what we strip out of untrusted names.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')

/** Illegal or awkward on common filesystems. */
const ILLEGAL_CHARS = /[<>:"|?*]/g

const MAX_LENGTH = 180

/**
 * Makes an attachment name from a PST safe to show in the UI and to hand to
 * a download's `download=` attribute.
 *
 * The name is fully attacker-controlled — it comes from whoever authored
 * the message, not from the person opening it — so it gets the same
 * treatment any untrusted filename would in a mail client:
 *
 *  - Bidirectional-override characters are stripped. Without this, a name
 *    containing U+202E renders as "invoice.jpg" while actually saving as
 *    an executable, which is a well-worn phishing trick.
 *  - Path separators and traversal are removed so the name can only ever be
 *    a leaf, never a path (browsers also enforce this for downloads, but
 *    not every consumer of this string is a browser download).
 *  - Control characters, reserved Windows device names, and trailing
 *    dots/spaces are neutralised so the saved file behaves on any OS.
 */
export function sanitizeFilename(raw: string, fallback: string): string {
  let name = raw
    .replace(BIDI_CONTROLS, '')
    .replace(CONTROL_CHARS, '')
    .replace(/[\\/]+/g, '/')

  // Collapse any path structure down to the final segment.
  name = name.slice(name.lastIndexOf('/') + 1)

  name = name
    .replace(ILLEGAL_CHARS, '_')
    // A leading dot would make a hidden file; trailing dots and spaces are
    // silently dropped by Windows and can be used to disguise an extension.
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()

  if (!name) return fallback
  if (RESERVED.test(name)) name = `_${name}`

  if (name.length > MAX_LENGTH) {
    // Preserve the extension when truncating, so the file still opens with
    // the right application.
    const dot = name.lastIndexOf('.')
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : ''
    name = name.slice(0, MAX_LENGTH - ext.length) + ext
  }

  return name || fallback
}
