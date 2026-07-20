import { drawStrokePoints } from "./render.js";

export function createInkSurface({ committedCanvas, wetCanvas, store, tools, onErase, onTextPoint }) {
  const committed = makeCanvasLayer(committedCanvas, false);
  const wet = makeCanvasLayer(wetCanvas, true);
  const state = {
    activePointerId: null,
    points: [],
    erasing: false
  };

  function resize() {
    resizeLayer(committed);
    resizeLayer(wet);
  }

  function pointerPoint(event) {
    const rect = wetCanvas.getBoundingClientRect();
    // Compensate for page zoom (CSS transform scale on the stage).
    const scale = rect.width > 0 ? wetCanvas.offsetWidth / rect.width : 1;
    const pressure = event.pointerType === "mouse" || event.pressure === 0
      ? 0.5
      : event.pressure;
    return [
      (event.clientX - rect.left) * scale,
      (event.clientY - rect.top) * scale,
      pressure,
      event.timeStamp
    ];
  }

  function beginStroke(event) {
    if (state.activePointerId !== null) {
      return;
    }
    const tool = tools.getTool();
    if (tool === "text") {
      event.preventDefault();
      const [x, y] = pointerPoint(event);
      onTextPoint({ x, y });
      return;
    }
    event.preventDefault();
    wetCanvas.setPointerCapture(event.pointerId);
    state.activePointerId = event.pointerId;
    if (tool === "eraser") {
      state.erasing = true;
      const [x, y] = pointerPoint(event);
      onErase({ x, y });
      return;
    }
    state.points = [pointerPoint(event)];
    drawWetStroke();
  }

  function moveStroke(event) {
    if (event.pointerId !== state.activePointerId) {
      return;
    }
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [event];
    if (state.erasing) {
      for (const coalescedEvent of events) {
        const [x, y] = pointerPoint(coalescedEvent);
        onErase({ x, y });
      }
      return;
    }
    for (const coalescedEvent of events) {
      state.points.push(pointerPoint(coalescedEvent));
    }
    drawWetStroke();
  }

  function endStroke(event) {
    if (event.pointerId !== state.activePointerId) {
      return;
    }
    event.preventDefault();
    if (!state.erasing && state.points.length > 0) {
      store.addStroke(state.points, tools.getPenStyle());
    }
    state.activePointerId = null;
    state.points = [];
    state.erasing = false;
    clearLayer(wet);
    if (wetCanvas.hasPointerCapture(event.pointerId)) {
      wetCanvas.releasePointerCapture(event.pointerId);
    }
  }

  function cancelStroke(event) {
    if (event.pointerId !== state.activePointerId) {
      return;
    }
    state.activePointerId = null;
    state.points = [];
    state.erasing = false;
    clearLayer(wet);
  }

  function drawWetStroke() {
    clearLayer(wet);
    drawStrokePoints(wet.context, { points: state.points, ...tools.getPenStyle() });
  }

  wetCanvas.addEventListener("pointerdown", beginStroke);
  wetCanvas.addEventListener("pointermove", moveStroke);
  wetCanvas.addEventListener("pointerup", endStroke);
  wetCanvas.addEventListener("pointercancel", cancelStroke);
  window.addEventListener("resize", resize);
  resize();

  return {
    resize,
    cancelActive() {
      state.activePointerId = null;
      state.points = [];
      state.erasing = false;
      clearLayer(wet);
    },
    destroy() {
      wetCanvas.removeEventListener("pointerdown", beginStroke);
      wetCanvas.removeEventListener("pointermove", moveStroke);
      wetCanvas.removeEventListener("pointerup", endStroke);
      wetCanvas.removeEventListener("pointercancel", cancelStroke);
      window.removeEventListener("resize", resize);
    }
  };
}

function makeCanvasLayer(canvas, desynchronized) {
  const context = canvas.getContext("2d", {
    alpha: true,
    desynchronized
  });
  context.lineJoin = "round";
  context.lineCap = "round";
  return { canvas, context, dpr: 1, width: 0, height: 0 };
}

function resizeLayer(layer) {
  // Layout (untransformed) size: stays stable under page zoom.
  const logicalWidth = layer.canvas.offsetWidth;
  const logicalHeight = layer.canvas.offsetHeight;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(logicalWidth * dpr));
  const height = Math.max(1, Math.round(logicalHeight * dpr));
  if (layer.canvas.width === width && layer.canvas.height === height) {
    return;
  }
  layer.dpr = dpr;
  layer.width = logicalWidth;
  layer.height = logicalHeight;
  layer.canvas.width = width;
  layer.canvas.height = height;
  layer.context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearLayer(layer) {
  layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
}
