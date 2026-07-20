# Kairo

A tablet-first handwriting workspace that eliminates scrolling while writing long solutions. Ink stays exactly where you write it — like a real notepad — and earlier lines gently shrink out of the way only when you need the room.

## Features

- **Notepad-true ink**: strokes never move while you write — not even with tight line spacing; layout adjusts only when you start the next line and space is needed.
- **Edit any line directly**: write on an earlier line to fix it (segmentation reopens it); tap a line to select, drag the handles to grow the selection, then pin or delete it.
- **Notes & pages**: welcome/home screen with all your notes, multiple pages per note, auto-saved locally.
- **Compacted history**: older lines gently shrink (never below 50%) so everything stays visible — no scrolling.
- **Pinned excerpt cards**: readable reference cards with editable labels; hover/tap opens a full-size overlay that stays while you keep writing.
- **AI layer** (via optional proxy): handwriting recognition per line, reference detection (keeps the referenced line full-size), key-result pin suggestions.
- **Question panel**: upload or paste (Ctrl+V) the problem; collapsible, tap to enlarge.
- **Tools**: pen (6 colors × 3 sizes), highlighter, stroke eraser, text boxes (4 fonts, 6 colors), undo/redo (Ctrl+Z / Ctrl+Y).
- **Design**: Lexend typeface (readability-optimized), calm indigo theme, plain / ruled / grid / dots paper, page widths, light and dark mode, first-run walkthrough.

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
