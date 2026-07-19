import { drawStrokePoints, isDarkTheme } from "./render.js";

const MIN_SCALE = 0.5;
const CACHE_SCALE_THRESHOLD = 0.1;
const LINE_HEIGHT_FALLBACK = 28;
const CACHE_PADDING = 12;
const HIT_SLOP = 6;
const TOP_MARGIN = 8;

let stage = null;
let historyLayer = null;
let getLines = null;
let getStrokes = null;
let getLineDy = () => 0;
let penPosition = null;
let penIsDown = false;
let queuedLayout = false;
let animationFrame = null;
let openLineId = null;
let committedLineIds = new Set();
let referenceLineIds = new Set();

const views = new Map();
const frozenLineIds = new Set();

export function installLayout(options) {
  stage = options.stage;
  getLines = options.getLines;
  getStrokes = options.getStrokes;
  if (options.getLineDy) {
    getLineDy = options.getLineDy;
  }

  historyLayer = document.createElement("div");
  historyLayer.className = "history-layer";
  stage.appendChild(historyLayer);

  stage.addEventListener("pointerdown", handlePointerDown, true);
  stage.addEventListener("pointermove", handlePointerMove, true);
  stage.addEventListener("pointerup", handlePointerUp, true);
  stage.addEventListener("pointercancel", handlePointerUp, true);
  window.addEventListener("resize", scheduleLayout);

  scheduleLayout();

  return {
    scheduleLayout,
    freezeLine,
    getLineView,
    hitTestLine,
    setReferenceLines,
    setCommitState,
    setLineDyProvider(provider) {
      getLineDy = provider;
    },
    unfreezeLine,
    destroy() {
      stage.removeEventListener("pointerdown", handlePointerDown, true);
      stage.removeEventListener("pointermove", handlePointerMove, true);
      stage.removeEventListener("pointerup", handlePointerUp, true);
      stage.removeEventListener("pointercancel", handlePointerUp, true);
      window.removeEventListener("resize", scheduleLayout);
      historyLayer.remove();
      views.clear();
    }
  };
}

export function scheduleLayout() {
  if (!stage || !historyLayer) {
    return;
  }
  if (penIsDown && hasProtectedView()) {
    queuedLayout = true;
    return;
  }
  queuedLayout = false;
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
  }
  animationFrame = requestAnimationFrame(applyLayout);
}

function applyLayout() {
  animationFrame = null;
  const lines = getLines();
  const strokesById = new Map(getStrokes().map((stroke) => [stroke.id, stroke]));
  const targetIds = new Set(lines.map((line) => line.id));

  for (const [lineId, view] of views) {
    if (!targetIds.has(lineId)) {
      view.element.remove();
      views.delete(lineId);
    }
  }

  const targets = getLayoutTargets(lines);

  for (const target of targets) {
    const lineStrokes = target.line.strokeIds
      .map((id) => strokesById.get(id))
      .filter(Boolean);
    const view = getOrCreateView(target.line);
    renderCacheIfNeeded(view, target.line, lineStrokes, target.scale);
    if (frozenLineIds.has(target.line.id)) {
      view.lastTarget = target;
      continue;
    }
    view.element.classList.toggle("is-reference", referenceLineIds.has(target.line.id));
    // Offset by the cache padding so the ink itself (not the padded canvas) lands
    // at target.x/y, keeping hit tests and pin affordances aligned with the ink.
    const inkX = target.x - CACHE_PADDING * target.scale;
    const inkY = target.y - CACHE_PADDING * target.scale;
    view.element.style.transform = `translate3d(${inkX}px, ${inkY}px, 0) scale(${target.scale})`;
    view.element.style.zIndex = String(10 + target.age);
    view.lastTarget = target;
  }
}

export function freezeLine(lineId) {
  frozenLineIds.add(lineId);
}

export function unfreezeLine(lineId) {
  frozenLineIds.delete(lineId);
  scheduleLayout();
}

export function hitTestLine(point, lineIds = null) {
  const allowed = lineIds ? new Set(lineIds) : null;
  for (const [lineId, view] of views) {
    if (allowed && !allowed.has(lineId)) {
      continue;
    }
    const target = view.lastTarget;
    if (!target) {
      continue;
    }
    const width = target.line.bbox.width * target.scale;
    const height = target.line.bbox.height * target.scale;
    const insideX = point.x >= target.x - HIT_SLOP && point.x <= target.x + width + HIT_SLOP;
    const insideY = point.y >= target.y - HIT_SLOP && point.y <= target.y + height + HIT_SLOP;
    if (insideX && insideY) {
      return {
        lineId,
        isCommitted: committedLineIds.has(lineId),
        transform: {
          x: target.x,
          y: target.y,
          scale: target.scale,
          bbox: { ...target.line.bbox }
        }
      };
    }
  }
  return null;
}

export function getLineView(lineId) {
  const view = views.get(lineId);
  const target = view?.lastTarget;
  if (!target) {
    return null;
  }
  return {
    lineId,
    isCommitted: committedLineIds.has(lineId),
    transform: {
      x: target.x,
      y: target.y,
      scale: target.scale,
      bbox: { ...target.line.bbox }
    }
  };
}

export function setCommitState(nextState) {
  openLineId = nextState.openLineId || null;
  committedLineIds = new Set(nextState.committedLineIds || []);
  scheduleLayout();
}

export function setReferenceLines(lineIds) {
  referenceLineIds = new Set(lineIds || []);
  scheduleLayout();
}

// Notepad-first layout: every line's home position is exactly where it was
// written (screen space). Older lines gently shrink in place. Lines are only
// pulled upward when the line below them needs the room — so ink never moves
// while writing, and compaction happens at next-line starts.
function getLayoutTargets(lines) {
  const rect = stage.getBoundingClientRect();
  const ordered = lines.filter((line) => committedLineIds.has(line.id) || line.id === openLineId);
  if (ordered.length === 0) {
    return [];
  }

  let committed = ordered.filter((line) => line.id !== openLineId);
  const openLine = ordered.find((line) => line.id === openLineId) || null;

  const targets = [];
  let ceilingBottom;

  // The anchor line (open line, or newest committed when idle) always sits
  // exactly where it was written; everything else stacks above it as needed.
  const anchorLine = openLine || committed[committed.length - 1];
  if (!openLine) {
    committed = committed.slice(0, -1);
  }
  const anchorY = Math.min(
    anchorLine.bbox.minY - getLineDy(anchorLine.id),
    rect.height - Math.max(LINE_HEIGHT_FALLBACK, anchorLine.bbox.height) - 8
  );
  targets.push({
    line: anchorLine,
    age: 0,
    scale: 1,
    x: anchorLine.bbox.minX,
    y: anchorY
  });
  ceilingBottom = anchorY - 6;

  // First pass: age-based scales, written positions clamped by the line below.
  const placed = [];
  for (let index = committed.length - 1; index >= 0; index -= 1) {
    const line = committed[index];
    const age = committed.length - 1 - index;
    const scale = referenceLineIds.has(line.id)
      ? 1
      : Math.max(MIN_SCALE, 1 - age * 0.09);
    const gap = Math.max(3, 10 - age * 1.5);
    const height = Math.max(LINE_HEIGHT_FALLBACK * 0.6, line.bbox.height) * scale;
    const writtenY = line.bbox.minY - getLineDy(line.id);
    const y = Math.min(writtenY, ceilingBottom - gap - height);
    placed.unshift({ line, age, scale, x: line.bbox.minX, y, height, gap });
    ceilingBottom = y;
  }

  // Overflow pass: if the stack ran off the top, squeeze scales toward the
  // minimum and re-stack from the bottom anchor.
  if (placed.length > 0 && placed[0].y < TOP_MARGIN) {
    const anchor = targets[0].y - 6;
    const available = anchor - TOP_MARGIN;
    const needed = placed.reduce((sum, item) => sum + item.height + item.gap, 0);
    const factor = needed > 0 ? Math.max(0.55, available / needed) : 1;
    let bottom = anchor;
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const item = placed[index];
      if (!referenceLineIds.has(item.line.id)) {
        item.scale = Math.max(MIN_SCALE, item.scale * factor);
      }
      item.height = Math.max(LINE_HEIGHT_FALLBACK * 0.6, item.line.bbox.height) * item.scale;
      item.gap = Math.max(2, item.gap * factor);
      item.y = bottom - item.gap - item.height;
      bottom = item.y;
    }
    // Final clamp: stagger anything still above the top edge.
    for (let index = 0; index < placed.length; index += 1) {
      placed[index].y = Math.max(placed[index].y, TOP_MARGIN + index * 3);
    }
  }

  for (const item of placed) {
    targets.push({ line: item.line, age: item.age, scale: item.scale, x: item.x, y: item.y });
  }
  return targets;
}

function getOrCreateView(line) {
  if (views.has(line.id)) {
    return views.get(line.id);
  }

  const element = document.createElement("canvas");
  element.className = "history-line";
  element.width = 1;
  element.height = 1;
  historyLayer.appendChild(element);

  const view = {
    element,
    context: element.getContext("2d"),
    cache: null,
    cacheContext: null,
    cacheScale: 0,
    cacheBbox: null,
    cacheStrokeKey: "",
    lastTarget: null
  };
  views.set(line.id, view);
  return view;
}

function renderCacheIfNeeded(view, line, strokes, displayScale) {
  const strokeKey = line.strokeIds.join("|") + (isDarkTheme() ? "|dark" : "|light");
  const cacheScaleChanged = view.cacheScale === 0
    || Math.abs(displayScale - view.cacheScale) / view.cacheScale > CACHE_SCALE_THRESHOLD;
  const bboxChanged = !view.cacheBbox
    || view.cacheBbox.width !== line.bbox.width
    || view.cacheBbox.height !== line.bbox.height
    || view.cacheBbox.minX !== line.bbox.minX
    || view.cacheBbox.minY !== line.bbox.minY;

  if (!cacheScaleChanged && !bboxChanged && view.cacheStrokeKey === strokeKey) {
    return;
  }

  const padding = CACHE_PADDING;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.ceil((line.bbox.width + padding * 2) * dpr));
  const height = Math.max(1, Math.ceil((line.bbox.height + padding * 2) * dpr));
  const cache = createCacheCanvas(width, height);
  const cacheContext = cache.getContext("2d");

  cacheContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  cacheContext.clearRect(0, 0, width, height);

  for (const stroke of strokes) {
    drawStrokePoints(cacheContext, stroke, -line.bbox.minX + padding, -line.bbox.minY + padding);
  }

  view.element.width = width;
  view.element.height = height;
  view.element.style.width = `${width / dpr}px`;
  view.element.style.height = `${height / dpr}px`;
  view.context.setTransform(1, 0, 0, 1, 0, 0);
  view.context.clearRect(0, 0, width, height);
  view.context.drawImage(cache, 0, 0);

  view.cache = cache;
  view.cacheContext = cacheContext;
  view.cacheScale = displayScale;
  view.cacheBbox = { ...line.bbox };
  view.cacheStrokeKey = strokeKey;
}

function createCacheCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function handlePointerDown(event) {
  penIsDown = true;
  penPosition = pointFromEvent(event);
}

function handlePointerMove(event) {
  penPosition = pointFromEvent(event);
  if (queuedLayout && !hasProtectedView()) {
    scheduleLayout();
  }
}

function handlePointerUp() {
  penIsDown = false;
  penPosition = null;
  if (queuedLayout) {
    scheduleLayout();
  }
}

function pointFromEvent(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function hasProtectedView() {
  if (!penPosition) {
    return false;
  }

  for (const view of views.values()) {
    const target = view.lastTarget;
    if (!target) {
      continue;
    }
    const lineHeight = Math.max(LINE_HEIGHT_FALLBACK, target.line.bbox.height) * target.scale;
    const top = target.y - lineHeight;
    const bottom = target.y + lineHeight * 2;
    if (penPosition.y >= top && penPosition.y <= bottom) {
      return true;
    }
  }

  return false;
}
