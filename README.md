# Kairo

A tablet-first handwriting workspace that eliminates scrolling while writing long solutions. Ink stays exactly where you write it — like a real notepad — and earlier lines gently shrink out of the way only when you need the room.

## Features

- **Notepad-true ink**: strokes never move while you write; layout adjusts only when you start the next line.
- **Compacted history**: older lines gently shrink (never below 50%) so everything stays visible — no scrolling.
- **Pinned excerpt cards**: tap a line to pin it as an always-visible reference card; tap the card for a full-size overlay.
- **AI layer** (via optional proxy): handwriting recognition per line, reference detection (keeps the referenced line full-size), key-result pin suggestions.
- **Question band**: upload or paste (Ctrl+V) a question image / screenshot, pinned at the top.
- **Tools**: pen (6 colors × 3 sizes), highlighter, stroke eraser, text boxes (4 fonts, 6 colors), undo/redo (Ctrl+Z / Ctrl+Y).
- **Paper**: plain / ruled / grid / dots backgrounds, full / medium / narrow page widths, light and dark mode.

## Run

Serve `frontend/` from any static host. Run the optional AI proxy from `backend/` with:

```sh
npm install
npm start
```

Set `OPENAI_API_KEY` for recognition and refinement. Without the proxy, the app keeps working with local fallback ranking.

When deploying the frontend separately from the backend (e.g. Vercel + Render), set `window.KAIRO_PROXY_URL` in `frontend/index.html` to the backend's deployed URL. Locally it defaults to `http://127.0.0.1:8787` automatically.

## Roadmap

Phone companion, PDF import, multi-document, sync.
