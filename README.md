# Kairo

A tablet-first handwriting workspace that eliminates scrolling while writing long solutions. Ink stays exactly where you write it — like a real notepad — and earlier lines gently shrink out of the way only when you need the room.

## Features

- **Notepad-true ink**: strokes never move while you write, at any line spacing; layout only ever adjusts once the page genuinely runs out of room (toggle: Auto / Never, in Page style).
- **Edit any line directly**: write on an earlier line to fix it (segmentation reopens it); tap a line to select, drag the handles to grow the selection, then pin or delete it.
- **Files → Notebooks → Pages**: a side panel holds nestable, color-coded files containing notebooks; drag a notebook onto a file to organize it. Each notebook has multiple pages. Everything (and every page/notebook/file deletion) auto-saves locally.
- **Pinned excerpt cards**: readable reference cards with editable labels in a dedicated rail; hover/tap opens a full-size overlay that stays while you keep writing.
- **Questions live on the page**: paste/insert an image or type one — Kairo detects the question automatically and surfaces it as a pinned card.
- **AI layer** (via optional proxy): handwriting recognition per line, reference detection (keeps the referenced line full-size), key-result pin suggestions.
- **Real paper sizes**: Full / A4 / A3 / Letter / Legal, always portrait — even zoomed out — plus zoom (50–200%, Ctrl+scroll) and scrolling.
- **Tools**: pen (6 colors × 3 sizes) and highlighter with barrel-style tool icons, stroke eraser, text boxes (4 fonts, 6 colors), undo/redo (Ctrl+Z / Ctrl+Y).
- **Design**: Lexend typeface, calm sage/brown theme, plain / ruled / grid / dots paper, light and dark mode, minimal welcome screen, first-run walkthrough.

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
