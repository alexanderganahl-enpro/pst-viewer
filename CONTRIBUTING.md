# Contributing

Thanks for considering a contribution!

## Getting started

```bash
git clone https://github.com/creedofman/pst-viewer.git
cd pst-viewer
npm install
npm run dev
```

Open the printed local URL and drag in any `.pst`/`.ost` file to test with (see the README
for where to find a small, public sample PST for testing).

## Guidelines

- **Keep it local-only.** The core promise of this project is that a PST file never leaves
  the browser tab. Please don't introduce a code path that sends the opened file, or any data
  derived from it, over the network (analytics included).
- **Read-only by design.** This app should never write to the file the user opened.
- Run `npx tsc -b --noEmit` and `npm run build` before opening a PR — CI runs both.
- Keep PRs focused; small, reviewable changes are much easier to merge.

## Project layout

- `src/worker/pstWorker.ts` — all PST-parsing logic, runs in a Web Worker via `pst-extractor`.
- `src/lib/pstClient.ts` — typed, promise-based bridge from the main thread to the worker.
- `src/components/` — presentation only; should stay unaware of `pst-extractor` internals.
- `src/types.ts` — the shared, structured-clone-safe types passed across the worker boundary.

## Reporting bugs

Please include the PST/OST version if known (Outlook 2003 "ANSI" PSTs are handled
differently from newer "Unicode" ones) and, if possible, a minimal file that reproduces the
issue — without any sensitive content.
