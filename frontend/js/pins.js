import { drawStrokePoints } from "./render.js";

const LONG_PRESS_MS = 600;
const DRAG_TOLERANCE = 8;
const CARD_INNER_WIDTH = 142;
const CARD_INNER_HEIGHT = 80;
const MAX_PINS = 4;

export function installPins(options) {
  const {
    stage,
    layout,
    getLines,
    getStrokes,
    isSelectionAllowed = () => true,
    onDeleteLines = () => {},
    onBeforeSelect = () => {}
  } = options;

  const state = {
    selection: null, // { lineIds: [contiguous line ids in document order] }
    pins: [],
    press: null,
    handleDrag: null,
    overlayKey: null,
    overlaySticky: false,
    lastCardEnter: 0
  };

  const highlight = document.createElement("div");
  highlight.className = "line-selection-highlight";
  highlight.hidden = true;
  stage.appendChild(highlight);

  const actionBar = document.createElement("div");
  actionBar.className = "line-action-bar";
  actionBar.hidden = true;

  const pinButton = document.createElement("button");
  pinButton.className = "line-pin-button";
  pinButton.type = "button";
  pinButton.title = "Pin selection as reference card";
  pinButton.setAttribute("aria-label", "Pin selection as reference card");
  pinButton.textContent = "Pin";

  const deleteButton = document.createElement("button");
  deleteButton.className = "line-delete-button";
  deleteButton.type = "button";
  deleteButton.title = "Delete selected lines";
  deleteButton.setAttribute("aria-label", "Delete selected lines");
  deleteButton.innerHTML = "<svg viewBox='0 0 20 20' aria-hidden='true'><path d='M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m2.5 0l-.7 9a1.5 1.5 0 01-1.5 1.4H7.7a1.5 1.5 0 01-1.5-1.4l-.7-9M8.2 9v5m3.6-5v5' fill='none' stroke='currentColor' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>";

  actionBar.appendChild(pinButton);
  actionBar.appendChild(deleteButton);
  stage.appendChild(actionBar);

  const topHandle = makeHandle("top");
  const bottomHandle = makeHandle("bottom");
  stage.appendChild(topHandle);
  stage.appendChild(bottomHandle);

  const column = document.createElement("aside");
  column.className = "pin-column";
  column.setAttribute("aria-label", "Pinned reference cards");
  stage.appendChild(column);

  const overlay = document.createElement("div");
  overlay.className = "pin-overlay";
  overlay.hidden = true;
  stage.appendChild(overlay);

  function makeHandle(edge) {
    const handle = document.createElement("div");
    handle.className = `selection-handle selection-handle-${edge}`;
    handle.hidden = true;
    handle.title = "Drag to include more lines";
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      state.handleDrag = { edge, pointerId: event.pointerId };
    });
    handle.addEventListener("pointermove", (event) => {
      if (!state.handleDrag || state.handleDrag.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      resizeSelection(state.handleDrag.edge, pointFromEvent(event, stage).y);
    });
    const endDrag = (event) => {
      if (state.handleDrag?.pointerId === event.pointerId) {
        state.handleDrag = null;
      }
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
    return handle;
  }

  function orderedLines() {
    return getLines();
  }

  function resizeSelection(edge, pointerY) {
    if (!state.selection) {
      return;
    }
    const lines = orderedLines();
    const rects = lines
      .map((line) => ({ line, view: layout.getLineView(line.id) }))
      .filter((entry) => entry.view);
    const currentIds = state.selection.lineIds;
    const anchorId = edge === "bottom" ? currentIds[0] : currentIds[currentIds.length - 1];
    const anchorIndex = rects.findIndex((entry) => entry.line.id === anchorId);
    if (anchorIndex === -1) {
      return;
    }

    const included = [anchorId];
    if (edge === "bottom") {
      for (let index = anchorIndex + 1; index < rects.length; index += 1) {
        const { transform } = rects[index].view;
        if (transform.y <= pointerY) {
          included.push(rects[index].line.id);
        } else {
          break;
        }
      }
    } else {
      for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const { transform } = rects[index].view;
        const bottom = transform.y + transform.bbox.height * transform.scale;
        if (bottom >= pointerY) {
          included.unshift(rects[index].line.id);
        } else {
          break;
        }
      }
    }
    state.selection = { lineIds: included };
    positionSelection();
  }

  function handlePointerDown(event) {
    if (!state.overlaySticky) {
      dismissOverlay();
    }
    if (!isSelectionAllowed()) {
      return;
    }
    if (event.target.closest(".pin-column, .line-action-bar, .selection-handle, .pin-overlay, .text-box")) {
      return;
    }

    const point = pointFromEvent(event, stage);
    const hit = layout.hitTestLine(point);
    if (!hit) {
      clearSelection();
      return;
    }

    // Selection matrix: finger-tap selects any line instantly; committed lines
    // also select on mouse click; the line being written (open) only selects
    // via press-and-hold so pointer-down can keep meaning "continue writing".
    if (event.pointerType === "touch" || (hit.isCommitted && event.pointerType === "mouse")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectLine(hit);
      return;
    }

    // Pen (any line) or mouse on the open line: let the event propagate so
    // writing / re-entry works; a still long-press selects instead.
    state.press = {
      pointerId: event.pointerId,
      start: point,
      hit,
      timer: window.setTimeout(() => {
        onBeforeSelect();
        selectLine(hit);
      }, LONG_PRESS_MS)
    };
  }

  function handlePointerMove(event) {
    if (!state.press || state.press.pointerId !== event.pointerId) {
      return;
    }
    const point = pointFromEvent(event, stage);
    if (distance(point, state.press.start) > DRAG_TOLERANCE) {
      cancelPress();
    }
  }

  function handlePointerUp(event) {
    if (!state.press || state.press.pointerId !== event.pointerId) {
      return;
    }
    cancelPress();
  }

  function selectLine(hit) {
    state.selection = { lineIds: [hit.lineId] };
    positionSelection();
  }

  function selectionRect() {
    if (!state.selection) {
      return null;
    }
    let rect = null;
    for (const lineId of state.selection.lineIds) {
      const view = layout.getLineView(lineId);
      if (!view) {
        continue;
      }
      const { transform } = view;
      const box = {
        left: transform.x,
        top: transform.y,
        right: transform.x + transform.bbox.width * transform.scale,
        bottom: transform.y + transform.bbox.height * transform.scale
      };
      rect = rect
        ? {
          left: Math.min(rect.left, box.left),
          top: Math.min(rect.top, box.top),
          right: Math.max(rect.right, box.right),
          bottom: Math.max(rect.bottom, box.bottom)
        }
        : box;
    }
    return rect;
  }

  function positionSelection() {
    const rect = selectionRect();
    if (!rect) {
      clearSelection();
      return;
    }
    const width = rect.right - rect.left;
    const height = Math.max(24, rect.bottom - rect.top);
    highlight.hidden = false;
    highlight.style.transform = `translate3d(${rect.left - 5}px, ${rect.top - 5}px, 0)`;
    highlight.style.width = `${width + 10}px`;
    highlight.style.height = `${height + 10}px`;

    actionBar.hidden = false;
    // Sit above the selection, out of the writing path.
    actionBar.style.transform = `translate3d(${Math.min(rect.right + 10, stage.clientWidth - 210)}px, ${Math.max(4, rect.top - 44)}px, 0)`;

    const centerX = rect.left + width / 2;
    topHandle.hidden = false;
    topHandle.style.transform = `translate3d(${centerX - 11}px, ${rect.top - 19}px, 0)`;
    bottomHandle.hidden = false;
    bottomHandle.style.transform = `translate3d(${centerX - 11}px, ${rect.bottom + 3}px, 0)`;
  }

  function clearSelection() {
    state.selection = null;
    highlight.hidden = true;
    actionBar.hidden = true;
    topHandle.hidden = true;
    bottomHandle.hidden = true;
  }

  function pinSelected(event) {
    event.preventDefault();
    event.stopPropagation();
    if (state.selection) {
      pinLine(state.selection.lineIds);
    }
    clearSelection();
  }

  function deleteSelected(event) {
    event.preventDefault();
    event.stopPropagation();
    if (state.selection) {
      onDeleteLines(state.selection.lineIds.slice());
    }
    clearSelection();
    renderPins();
  }

  function pinLine(lineIdOrIds) {
    const lineIds = (Array.isArray(lineIdOrIds) ? lineIdOrIds : [lineIdOrIds]).filter(Boolean);
    const existing = lineIds.filter((id) => getLines().some((line) => line.id === id));
    if (existing.length === 0) {
      return;
    }
    const key = existing.join("+");
    state.pins = state.pins.filter((pin) => pin.key !== key);
    state.pins.unshift({ key, lineIds: existing });
    state.pins = state.pins.slice(0, MAX_PINS);
    renderPins();
  }

  function pinContent(pin) {
    const lines = getLines().filter((line) => pin.lineIds.includes(line.id));
    if (lines.length === 0) {
      return null;
    }
    const strokeIds = new Set(lines.flatMap((line) => line.strokeIds));
    const strokes = getStrokes().filter((stroke) => strokeIds.has(stroke.id));
    let bbox = null;
    for (const line of lines) {
      bbox = bbox
        ? {
          minX: Math.min(bbox.minX, line.bbox.minX),
          minY: Math.min(bbox.minY, line.bbox.minY),
          maxX: Math.max(bbox.maxX, line.bbox.maxX),
          maxY: Math.max(bbox.maxY, line.bbox.maxY)
        }
        : { minX: line.bbox.minX, minY: line.bbox.minY, maxX: line.bbox.maxX, maxY: line.bbox.maxY };
    }
    bbox.width = Math.max(1, bbox.maxX - bbox.minX);
    bbox.height = Math.max(1, bbox.maxY - bbox.minY);
    return { lines, strokes, bbox };
  }

  function renderPins() {
    column.replaceChildren();
    for (const pin of state.pins) {
      const content = pinContent(pin);
      if (!content) {
        continue;
      }
      const card = document.createElement("div");
      card.className = "pin-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.title = "Hover or tap to read full size (stays open while you write)";

      const canvasWrap = document.createElement("span");
      canvasWrap.className = "pin-card-ink";
      const canvas = document.createElement("canvas");
      canvasWrap.appendChild(canvas);
      card.appendChild(canvasWrap);

      const unpin = document.createElement("button");
      unpin.className = "pin-card-remove";
      unpin.type = "button";
      unpin.title = "Unpin";
      unpin.setAttribute("aria-label", "Unpin card");
      unpin.textContent = "×";
      card.appendChild(unpin);

      const crop = getCardCrop(content);
      if (crop.cropped) {
        card.classList.add("is-cropped");
      }
      renderInk(canvas, content.strokes, crop);

      card.addEventListener("pointerenter", (event) => {
        if (event.pointerType === "touch") {
          return;
        }
        state.lastCardEnter = Date.now();
        toggleOverlay(pin);
      });
      card.addEventListener("click", () => {
        if (Date.now() - state.lastCardEnter < 500) {
          return;
        }
        toggleOverlay(pin);
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleOverlay(pin);
        }
      });
      unpin.addEventListener("pointerenter", (event) => event.stopPropagation());
      unpin.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.pins = state.pins.filter((candidate) => candidate.key !== pin.key);
        if (state.overlayKey === pin.key) {
          dismissOverlay();
        }
        renderPins();
      });
      column.appendChild(card);
    }
  }

  // Sticky toggle: hover/tap opens the full-size overlay and it STAYS while the
  // user keeps writing; hover/tap the card again to close it.
  function toggleOverlay(pin) {
    if (state.overlayKey === pin.key && !overlay.hidden) {
      dismissOverlay();
      return;
    }
    const content = pinContent(pin);
    if (!content) {
      return;
    }
    overlay.replaceChildren();
    const canvas = document.createElement("canvas");
    overlay.appendChild(canvas);
    renderInk(canvas, content.strokes, {
      ...content.bbox,
      cropped: false,
      targetWidth: Math.min(stage.clientWidth - 220, Math.max(280, content.bbox.width)),
      targetHeight: Math.min(200, Math.max(52, content.bbox.height + 24))
    });
    overlay.hidden = false;
    state.overlayKey = pin.key;
    state.overlaySticky = true;
  }

  function showImageOverlay(src, alt = "Question") {
    overlay.replaceChildren();
    const image = document.createElement("img");
    image.src = src;
    image.alt = alt;
    image.className = "pin-overlay-image";
    overlay.appendChild(image);
    overlay.hidden = false;
    state.overlayKey = "question-image";
    state.overlaySticky = false;
  }

  function dismissOverlay() {
    overlay.hidden = true;
    state.overlayKey = null;
    state.overlaySticky = false;
  }

  function getCardCrop(content) {
    const { bbox } = content;
    if (bbox.width <= CARD_INNER_WIDTH * 3) {
      return {
        ...bbox,
        cropped: false,
        targetWidth: CARD_INNER_WIDTH,
        targetHeight: CARD_INNER_HEIGHT
      };
    }

    const cropStart = findCropStart(content.strokes) ?? bbox.minX + bbox.width * 0.6;
    const minX = Math.min(bbox.maxX - CARD_INNER_WIDTH, cropStart);
    return {
      minX,
      maxX: bbox.maxX,
      minY: bbox.minY,
      maxY: bbox.maxY,
      width: Math.max(1, bbox.maxX - minX),
      height: bbox.height,
      cropped: true,
      targetWidth: CARD_INNER_WIDTH,
      targetHeight: CARD_INNER_HEIGHT
    };
  }

  function findCropStart(strokes) {
    const symbolLike = strokes
      .map((stroke) => ({ stroke, bbox: strokeBbox(stroke) }))
      .filter(({ bbox }) => bbox.width >= 8 && bbox.width > bbox.height * 1.8)
      .sort((left, right) => left.bbox.minX - right.bbox.minX);
    if (symbolLike.length === 0) {
      return null;
    }
    return symbolLike[symbolLike.length - 1].bbox.maxX + 8;
  }

  function renderInk(canvas, strokes, crop) {
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(
      crop.targetWidth / crop.width,
      crop.targetHeight / Math.max(1, crop.height + 16)
    );
    const width = Math.max(1, Math.round(crop.targetWidth * dpr));
    const height = Math.max(1, Math.round(crop.targetHeight * dpr));
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${crop.targetWidth}px`;
    canvas.style.height = `${crop.targetHeight}px`;
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, crop.targetWidth, crop.targetHeight);
    context.save();
    context.beginPath();
    context.rect(0, 0, crop.targetWidth, crop.targetHeight);
    context.clip();
    // Center the ink block inside the card.
    const drawnHeight = crop.height * scale;
    const drawnWidth = crop.width * scale;
    context.translate(
      Math.max(0, (crop.targetWidth - drawnWidth) / 2),
      Math.max(4, (crop.targetHeight - drawnHeight) / 2)
    );
    context.scale(scale, scale);
    for (const stroke of strokes) {
      drawStrokePoints(context, stroke, -crop.minX, -crop.minY);
    }
    context.restore();
  }

  function cancelPress() {
    if (!state.press) {
      return;
    }
    window.clearTimeout(state.press.timer);
    state.press = null;
  }

  pinButton.addEventListener("click", pinSelected);
  deleteButton.addEventListener("click", deleteSelected);
  stage.addEventListener("pointerdown", handlePointerDown, true);
  stage.addEventListener("pointermove", handlePointerMove, true);
  stage.addEventListener("pointerup", handlePointerUp, true);
  stage.addEventListener("pointercancel", handlePointerUp, true);

  return {
    pinLine,
    renderPins,
    showImageOverlay,
    destroy() {
      cancelPress();
      stage.removeEventListener("pointerdown", handlePointerDown, true);
      stage.removeEventListener("pointermove", handlePointerMove, true);
      stage.removeEventListener("pointerup", handlePointerUp, true);
      stage.removeEventListener("pointercancel", handlePointerUp, true);
      highlight.remove();
      actionBar.remove();
      topHandle.remove();
      bottomHandle.remove();
      column.remove();
      overlay.remove();
    }
  };
}

function pointFromEvent(event, stage) {
  const rect = stage.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function strokeBbox(stroke) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of stroke.points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}
