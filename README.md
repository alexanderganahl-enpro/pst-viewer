# PST Viewer

A small, open-source PST file browser that runs **entirely in your browser**. Open an
Outlook `.pst` (or `.ost`) file and browse its folders, messages, and attachments — nothing
is uploaded, streamed, or sent anywhere. There is no backend.

**[Open the app →](https://creedofman.github.io/pst-viewer/)**

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

> This branch adds archive-wide search, backed by a background header index — see
> [Background search index](#background-search-index) below. It's deployed alongside main for
> testing at **[/new →](https://creedofman.github.io/pst-viewer/new/)**; main is unaffected
> until this is merged.

Sibling project to **[msg-viewer](https://github.com/creedofman/msg-viewer)** — same
Outlook-on-the-web styling, same local-only architecture, same privacy guarantees. Where
this app reads a whole PST mailbox archive, msg-viewer reads one `.msg` message file at a
time.

## Why

PST files often contain sensitive mail archives, and most "PST viewer" tools online ask you
to upload the file to a server. This one doesn't have a server to upload to — it's a static
site. The `.pst` file you pick is read straight from disk into browser memory by JavaScript
and parsed there; it never leaves the tab.

## Features

- 📂 Full folder tree, message list, and reading pane — a familiar three-pane layout styled
  after Outlook on the web / Microsoft 365
- 🔒 100% local: no network requests are made with your data, ever — enforced by a
  `connect-src 'none'` Content-Security-Policy, not just by convention
- 🚫 Tracking pixels blocked: remote images and other remote content in a message are
  blocked by default, so opening mail doesn't tell the sender you read it
- 👀 Read-only: the file is only ever read, never modified or re-written
- 📎 View and save attachments locally (as a normal browser download)
- 🔍 Search within the open folder, or across the whole archive once it's indexed (see below)
- ⚡ Handles large mailboxes without choking the UI (virtualized message list, off-main-thread
  parsing in a Web Worker)
- 🌗 Light and dark mode, following your system setting

## How it works

- PST parsing is done by [`pst-extractor`](https://github.com/epfromer/pst-extractor), a pure
  JavaScript/TypeScript port of the PST format reader from Apache's `libpst`/`java-libpst`
  lineage, running inside a Web Worker so the UI stays responsive.
- The file you choose is read with the standard `File` API (`file.arrayBuffer()`) — this is a
  local file read, not a form upload. It's transferred once into the worker and never touches
  `fetch`, `XMLHttpRequest`, or any network API.
- Message HTML bodies are sanitized ([DOMPurify](https://github.com/cure53/DOMPurify)) and
  rendered inside a sandboxed, script-disabled `<iframe>`, so a crafted email body can't run
  script in the page.
- The whole thing is a static site (Vite + React + TypeScript) with no server component,
  deployed to GitHub Pages.

## Running locally

```bash
npm install
npm run dev
```

Then open the printed `http://localhost` URL and pick a `.pst`/`.ost` file.

To build the static site the same way the deploy workflow does:

```bash
npm run build
npm run preview
```

## Privacy & security notes

- **The app makes no network requests at all.** It's a static site with no backend, and the
  shipped bundle contains no `fetch`/`XMLHttpRequest`/`WebSocket` calls whatsoever. This is
  enforced rather than merely intended: the page ships a
  `Content-Security-Policy` with `connect-src 'none'`, so the browser blocks any attempt to
  send data anywhere — including from a future change or a dependency.
- **Remote content in messages is blocked by default.** This is the one place a "local"
  mail viewer can leak without meaning to: an HTML email containing
  `<img src="https://tracker.example/pixel.gif?you=someone">` is a read receipt, telling the
  sender you opened it, when, and from what IP. Two independent layers stop it — the
  sanitizer strips remote URLs from attributes, and the message body's iframe carries its own
  `default-src 'none'` CSP that also catches what attribute-stripping can't see (CSS
  `url()`, `@import`, webfonts). When a message has blocked content you get a banner and can
  load it for that one message; doing so is a deliberate, per-message choice.
- **No scripting in message bodies.** Bodies render in a sandboxed iframe without
  `allow-scripts`, and are sanitized with DOMPurify first.
- **Attachment names are treated as hostile.** They come from whoever sent the mail, so
  they're stripped of bidirectional-override characters (the `invoice.jpg` that's really
  `.exe` trick), path separators, and control characters before being displayed or used as a
  download name.
- Attachment downloads use a local `Blob` URL — the same mechanism any "Save As" button in a
  web app uses. Nothing is sent anywhere first.
- The file is only read. This app never writes to, or otherwise modifies, the PST/OST file
  you open.
- **The search index never leaves your device either.** It's built from message headers only
  (subject, sender, recipients — never bodies or attachments) and cached in this browser
  tab's IndexedDB, purely so reopening the same file skips re-indexing. See
  [Background search index](#background-search-index) for what's stored and how to clear it.

None of this is a substitute for your own judgment — if a `.pst` file's contents are
sensitive, that sensitivity doesn't change just because the tool reading it is local-only.

## Memory model

Opening a file picks one of two modes, decided purely by size:

- **Under ~1 GB** ("eager"): the file is read into memory once via `file.arrayBuffer()` and
  *transferred* (not copied) into the parsing Web Worker — simple and fast for anything that
  comfortably fits.
- **At/above ~1 GB** ("lazy"): the `File` object itself is handed to the worker, which reads
  byte ranges from disk on demand (`File.slice()` + the in-worker-only `FileReaderSync`) as
  `pst-extractor` asks for them, through a small LRU-cached shim
  ([lazyFileSource.ts](src/worker/lazyFileSource.ts)) that stands in for an in-memory buffer
  without ever allocating one. The whole file is never resident in memory at once — memory use
  stays low (a bounded ~32 MB block cache, plus whatever folders/messages you've actually
  browsed) regardless of how large the PST is. The trade-off is more, smaller disk reads, so
  browsing can be a little slower, especially on a slow disk.

Either way:

- Closing a file (or opening a new one) terminates the worker outright, releasing everything
  it was holding — no gradual leak across files opened in one session.
- Only the last few folders you've browsed are kept parsed in memory; older ones are evicted
  (LRU) so panning around a mailbox with many huge folders doesn't accumulate without bound.

The lazy mode's cache/copy logic has unit tests
([lazyFileSource.test.ts](src/worker/__tests__/lazyFileSource.test.ts)) covering block-boundary
stitching, the short final block, EOF clamping, and cache eviction — run with `npm test`.

## Background search index

Opening a file starts a background pass that indexes every folder's headers (subject, sender,
recipients — never bodies or attachments) so you can search the whole archive, not just the
open folder. It's designed to never get in your way:

- **Never blocks browsing.** Indexing runs in the same Web Worker as everything else, in short
  slices (a few milliseconds each) that yield between batches — any folder you click or
  message you open jumps the queue. Classic per-folder loading is completely unchanged; the
  index is a separate, additive structure built alongside it, not a replacement for it.
- **Self-paced.** Slice size adapts to how fast your machine actually is, so a slow device
  still stays responsive; a fast one finishes indexing sooner.
- **Capped, honestly.** Indexing stops at roughly 2,000,000 messages (~330 MB) so an
  enormous archive can't grow memory use without bound. If a file hits that cap, the status
  panel says so plainly — search covers what got indexed, not the whole file.
- **Cached, and clearable.** Progress is saved to this browser's IndexedDB per folder, keyed
  to the opened file's size and modified time, so reopening the same file resumes instead of
  re-indexing from scratch. A "Clear cached index" control in the status panel removes it.
- **Visible and controllable.** A status bar under the toolbar shows messages/folders indexed
  and the current folder, with Pause/Resume and Skip controls — indexing is something you can
  see and stop, not something happening silently in the background.

Search-all-mail results resolve to real messages: selecting one opens it through the same
`getMessage()` call a normal click uses, in whichever folder it's actually in.

## Limitations

- Calendar, contact, and task items aren't rendered with dedicated views yet — this first
  release focuses on mail.
- RTF-only message bodies (no plain text or HTML alternative) aren't rendered; this is
  uncommon in modern PSTs.
- Extremely large files (tens of GB) haven't been tested and may hit browser-specific `Blob`
  size limits, even in lazy mode.

Contributions that address any of the above are very welcome — see below.

## Contributing

Issues and pull requests are welcome. This is a small project: `src/worker/pstWorker.ts`
holds all the PST-parsing logic, `src/lib/pstClient.ts` is the typed bridge to the main
thread, and everything under `src/components/` is presentation.

```bash
npm install
npm run dev
```

Please keep the core privacy property intact: this app should never gain a code path that
sends the opened file, or data derived from it, to a network endpoint.

## License

[MIT](LICENSE) — this project is not affiliated with or endorsed by Microsoft. "Outlook" and
"Microsoft 365" are trademarks of Microsoft Corporation, referenced here only to describe
compatibility and visual styling.
