import { drawStrokePoints } from "./render.js";

const REFINE_DEBOUNCE_MS = 5000;
const PROXY_BASE_URL = resolveProxyBaseUrl();

export function installAi(options) {
  const {
    stage,
    getLines,
    getStrokes,
    layout,
    pins,
    setLineText,
    setLineKeyResult
  } = options;

  const state = {
    recognized: new Map(),
    referenceLineId: null,
    currentLineId: null,
    strokeVersion: 0,
    lastRefinedVersion: -1,
    refineTimer: null,
    ghostButtons: new Map()
  };

  async function handleLineCommit(lineId) {
    const line = getLines().find((candidate) => candidate.id === lineId);
    if (!line || state.recognized.has(lineId)) {
      return;
    }
    // Empty until real recognition arrives: fake text would poison the overlap ranking.
    setRecognizedText(lineId, "");

    try {
      const text = await postJson("/recognize", {
        lineImage: renderLinePng(line)
      });
      if (typeof text.text === "string") {
        setRecognizedText(lineId, text.text);
      }
    } catch {
      // Silent degrade: cached fallback remains good enough for local ranking.
    }
  }

  function handlePenLift() {
    state.strokeVersion += 1;
    window.clearTimeout(state.refineTimer);
    state.refineTimer = window.setTimeout(refineCurrentLine, REFINE_DEBOUNCE_MS);
  }

  async function refineCurrentLine() {
    if (state.lastRefinedVersion === state.strokeVersion) {
      return;
    }
    state.lastRefinedVersion = state.strokeVersion;

    const lines = getLines();
    const currentLine = lines[lines.length - 1];
    if (!currentLine) {
      return;
    }
    state.currentLineId = currentLine.id;

    const priorLines = lines
      .filter((line) => line.id !== currentLine.id && state.recognized.get(line.id))
      .map((line) => ({ id: line.id, text: state.recognized.get(line.id) }));
    const fallback = rankByTokenOverlap(currentLine, priorLines);
    applyRefinement(fallback);

    try {
      const result = await postJson("/refine", {
        currentLineImage: renderLinePng(currentLine),
        priorLines
      });
      applyRefinement({
        referencedLineId: result.referencedLineId || fallback.referencedLineId,
        isKeyResult: Boolean(result.isKeyResult)
      });
    } catch {
      // Silent degrade: client-side ranking remains active.
    }
  }

  function applyRefinement(result) {
    state.referenceLineId = result.referencedLineId || null;
    layout.setReferenceLines(state.referenceLineId ? [state.referenceLineId] : []);

    if (state.currentLineId && result.isKeyResult) {
      setLineKeyResult(state.currentLineId, true);
      renderGhostPins();
    }
  }

  function renderGhostPins() {
    for (const button of state.ghostButtons.values()) {
      button.remove();
    }
    state.ghostButtons.clear();

    for (const line of getLines().filter((candidate) => candidate.isKeyResult)) {
      const hit = layout.getLineView(line.id);
      if (!hit) {
        continue;
      }
      const button = document.createElement("button");
      button.className = "ghost-pin-button";
      button.type = "button";
      button.title = "Confirm suggested pin";
      button.textContent = "Pin";
      const width = hit.transform.bbox.width * hit.transform.scale;
      button.style.transform = `translate3d(${Math.min(hit.transform.x + width + 8, stage.clientWidth - 224)}px, ${hit.transform.y + 28}px, 0)`;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        pins.pinLine(line.id);
        setLineKeyResult(line.id, false);
        renderGhostPins();
      });
      stage.appendChild(button);
      state.ghostButtons.set(line.id, button);
    }
  }

  function setRecognizedText(lineId, text) {
    const cleanText = text.trim();
    state.recognized.set(lineId, cleanText);
    setLineText(lineId, cleanText);
  }

  function rankByTokenOverlap(currentLine, priorLines) {
    const currentTokens = tokenize(state.recognized.get(currentLine.id) || "");
    if (currentTokens.length === 0 || priorLines.length === 0) {
      return { referencedLineId: null, isKeyResult: false };
    }

    const documents = priorLines.map((line) => new Set(tokenize(line.text)));
    let best = { id: null, score: 0 };
    for (let index = 0; index < priorLines.length; index += 1) {
      let score = 0;
      const priorTokens = documents[index];
      for (const token of currentTokens) {
        if (!priorTokens.has(token)) {
          continue;
        }
        const documentFrequency = documents.filter((document) => document.has(token)).length;
        score += Math.log((priorLines.length + 1) / (documentFrequency + 1)) + 1;
      }
      if (score > best.score) {
        best = { id: priorLines[index].id, score };
      }
    }
    return {
      referencedLineId: best.score > 0 ? best.id : null,
      isKeyResult: currentTokens.includes("=") || currentTokens.includes("therefore")
    };
  }

  function tokenize(text) {
    return String(text)
      .toLowerCase()
      .match(/[a-z0-9_]+|=|[+\-*/^]/g) || [];
  }

  function renderLinePng(line) {
    const canvas = document.createElement("canvas");
    const padding = 12;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.ceil((line.bbox.width + padding * 2) * dpr));
    const height = Math.max(1, Math.ceil((line.bbox.height + padding * 2) * dpr));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width / dpr, height / dpr);
    for (const stroke of strokesForLine(line)) {
      // Always render black-on-white for recognition contrast, whatever the pen color.
      drawStrokePoints(context, stroke, -line.bbox.minX + padding, -line.bbox.minY + padding, "#1f2933");
    }
    return canvas.toDataURL("image/png");
  }

  function strokesForLine(line) {
    const strokeIds = new Set(line.strokeIds);
    return getStrokes().filter((stroke) => strokeIds.has(stroke.id));
  }

  return {
    handleLineCommit,
    handlePenLift,
    renderGhostPins
  };
}

function resolveProxyBaseUrl() {
  const configured = typeof window !== "undefined" ? window.KAIRO_PROXY_URL : "";
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const isLocalHost = typeof window !== "undefined"
    && ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return isLocalHost ? "http://127.0.0.1:8787" : "";
}

async function postJson(path, body) {
  if (!PROXY_BASE_URL) {
    throw new Error("proxy unavailable");
  }
  const response = await fetch(`${PROXY_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error("proxy unavailable");
  }
  return response.json();
}

