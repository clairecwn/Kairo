import { createInkSurface } from "./ink.js";
import { installAi } from "./ai.js";
import { installCommitController } from "./commit.js";
import { installLayout, scheduleLayout } from "./layout.js";
import { installPins } from "./pins.js";
import { installText } from "./text.js";
import { installTools, FONTS, BACKGROUNDS, PAGE_SIZES } from "./tools.js";
import { PEN_COLORS, PEN_SIZES, resolveStrokeColor } from "./render.js";
import {
  assignStroke,
  assignStrokeToLine,
  createNewLineForStroke,
  getLastAssignment,
  getLines,
  removeStrokeFromLine,
  restoreLine,
  setLineKeyResult,
  setLineText
} from "./lines.js";
import {
  addStroke as addStoredStroke,
  getStrokes,
  removeStroke as removeStoredStroke,
  restoreStroke
} from "./store.js";

const committedCanvas = document.querySelector("#committed-canvas");
const wetCanvas = document.querySelector("#wet-canvas");
const inkStage = document.querySelector(".ink-stage");
const stageWrap = document.querySelector(".stage-wrap");
const questionBand = document.querySelector(".question-band");

const tools = installTools();

const layout = installLayout({
  stage: inkStage,
  getLines,
  getStrokes
});
const pins = installPins({
  stage: inkStage,
  layout,
  getLines,
  getStrokes,
  isSelectionAllowed: () => tools.getTool() === "pen" || tools.getTool() === "highlighter",
  onDeleteLines: deleteLines,
  onBeforeSelect: () => inkSurface?.cancelActive()
});
const ai = installAi({
  stage: inkStage,
  getLines,
  getStrokes,
  layout,
  pins,
  setLineText,
  setLineKeyResult
});
const commit = installCommitController({
  stage: inkStage,
  addStroke: addStoredStroke,
  assignStroke,
  assignStrokeToLine,
  createNewLineForStroke,
  getLastAssignment,
  getLines,
  layout,
  isDrawingTool: () => tools.getTool() === "pen" || tools.getTool() === "highlighter",
  onLineCommit: ai.handleLineCommit,
  onPenLift: ai.handlePenLift
});
layout.setLineDyProvider(commit.getLineDy);

const text = installText({ stage: inkStage, tools });

const inkSurface = createInkSurface({
  committedCanvas,
  wetCanvas,
  tools,
  store: {
    addStroke(points, style) {
      const id = commit.addStroke(points, style);
      tools.history.push({
        undo: () => eraseStrokeById(id),
        redo: () => restoreStrokeById(id)
      });
      return id;
    },
    getStrokes
  },
  onErase: eraseAt,
  onTextPoint: (point) => text.addTextBox(point)
});

const erasedRecords = new Map();

function eraseStrokeById(strokeId) {
  const record = removeStoredStroke(strokeId);
  if (!record) {
    return;
  }
  const removal = removeStrokeFromLine(strokeId, getStrokes());
  erasedRecords.set(strokeId, { record, lineId: removal?.lineId || null });
  layout.scheduleLayout();
  pins.renderPins();
}

function restoreStrokeById(strokeId) {
  const entry = erasedRecords.get(strokeId);
  if (!entry) {
    return;
  }
  restoreStroke(entry.record);
  if (entry.lineId) {
    restoreLine(entry.lineId);
    assignStrokeToLine({ id: strokeId, points: entry.record.points }, entry.lineId);
    commit.commitLine(entry.lineId);
  } else {
    assignStroke({ id: strokeId, points: entry.record.points });
  }
  erasedRecords.delete(strokeId);
  layout.scheduleLayout();
  pins.renderPins();
}

function deleteLines(lineIds) {
  const strokeIds = [];
  for (const lineId of lineIds) {
    const line = getLines().find((candidate) => candidate.id === lineId);
    if (line) {
      strokeIds.push(...line.strokeIds);
    }
  }
  if (strokeIds.length === 0) {
    return;
  }
  for (const strokeId of strokeIds) {
    eraseStrokeById(strokeId);
  }
  tools.history.push({
    undo: () => {
      for (const strokeId of [...strokeIds].reverse()) {
        restoreStrokeById(strokeId);
      }
    },
    redo: () => {
      for (const strokeId of strokeIds) {
        eraseStrokeById(strokeId);
      }
    }
  });
}

function eraseAt(point) {
  const hit = layout.hitTestLine(point);
  if (!hit) {
    return;
  }
  const { transform } = hit;
  const docX = transform.bbox.minX + (point.x - transform.x) / transform.scale;
  const docY = transform.bbox.minY + (point.y - transform.y) / transform.scale;
  const radius = 14 / transform.scale;

  const line = getLines().find((candidate) => candidate.id === hit.lineId);
  if (!line) {
    return;
  }
  const lineStrokeIds = new Set(line.strokeIds);
  const toRemove = getStrokes().filter((stroke) => {
    if (!lineStrokeIds.has(stroke.id)) {
      return false;
    }
    return stroke.points.some(([x, y]) => Math.hypot(x - docX, y - docY) <= radius);
  });

  for (const stroke of toRemove) {
    eraseStrokeById(stroke.id);
    tools.history.push({
      undo: () => restoreStrokeById(stroke.id),
      redo: () => eraseStrokeById(stroke.id)
    });
  }
}

installToolbar();
installQuestionBand(questionBand, pins);
installEmptyHint();
installTour();
installServiceWorker();

/* ---------- Empty-state hint ---------- */

function installEmptyHint() {
  const hint = document.createElement("div");
  hint.className = "empty-hint";
  hint.innerHTML = "<strong>Write anywhere ✍️</strong><span>Your ink stays put. Return to the left margin and drop down a line when you're ready — take all the thinking time you need.</span>";
  inkStage.appendChild(hint);
  const hide = () => {
    hint.classList.add("is-hidden");
    wetCanvas.removeEventListener("pointerdown", hide);
  };
  wetCanvas.addEventListener("pointerdown", hide);
}

/* ---------- First-run walkthrough ---------- */

function installTour() {
  const steps = [
    {
      target: ".question-preview",
      title: "Your question stays pinned",
      body: "Upload or paste (Ctrl+V) the problem. Tap it any time to read it full-size."
    },
    {
      target: ".ink-stage",
      title: "Just write — no timers",
      body: "Ink stays exactly where you put it. Start a new line by returning to the left margin and dropping down. Pause to think as long as you like."
    },
    {
      target: ".tool-groups",
      title: "Your toolkit",
      body: "Pens and colors, highlighter, eraser, text boxes, undo/redo — plus paper styles, page width, and dark mode."
    },
    {
      target: ".ink-stage",
      title: "Pin and manage lines",
      body: "Tap a written line to select it. Drag the round handles to include neighbouring lines, then Pin it as a reference card — or delete it. Hover a card to read it full-size while you keep writing."
    }
  ];

  let layer = null;
  let stepIndex = 0;

  function open() {
    close();
    stepIndex = 0;
    layer = document.createElement("div");
    layer.className = "tour-layer";
    layer.innerHTML = `
      <div class="tour-spotlight"></div>
      <div class="tour-popover" role="dialog" aria-live="polite">
        <h2 class="tour-title"></h2>
        <p class="tour-body"></p>
        <div class="tour-actions">
          <button type="button" class="tour-skip">Skip</button>
          <span class="tour-count"></span>
          <button type="button" class="tour-next">Next</button>
        </div>
      </div>`;
    document.body.appendChild(layer);
    layer.querySelector(".tour-skip").addEventListener("click", finish);
    layer.querySelector(".tour-next").addEventListener("click", () => {
      stepIndex += 1;
      if (stepIndex >= steps.length) {
        finish();
      } else {
        show();
      }
    });
    show();
  }

  function show() {
    const step = steps[stepIndex];
    const target = document.querySelector(step.target);
    const rect = target
      ? target.getBoundingClientRect()
      : { left: 0, top: 0, width: 0, height: 0 };
    const spotlight = layer.querySelector(".tour-spotlight");
    const pad = 8;
    spotlight.style.left = `${rect.left - pad}px`;
    spotlight.style.top = `${rect.top - pad}px`;
    spotlight.style.width = `${rect.width + pad * 2}px`;
    spotlight.style.height = `${rect.height + pad * 2}px`;

    layer.querySelector(".tour-title").textContent = step.title;
    layer.querySelector(".tour-body").textContent = step.body;
    layer.querySelector(".tour-count").textContent = `${stepIndex + 1} / ${steps.length}`;
    layer.querySelector(".tour-next").textContent = stepIndex === steps.length - 1 ? "Done" : "Next";

    const popover = layer.querySelector(".tour-popover");
    const below = rect.top + rect.height + 20;
    popover.style.top = below + 180 < window.innerHeight ? `${below}px` : "90px";
    popover.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 360))}px`;
  }

  function finish() {
    close();
    try {
      window.localStorage.setItem("kairo.tourDone", "1");
    } catch {
      // Storage unavailable; skip persisting.
    }
  }

  function close() {
    layer?.remove();
    layer = null;
  }

  document.querySelector("[data-action='help']")?.addEventListener("click", open);

  if (!window.localStorage.getItem("kairo.tourDone")) {
    window.setTimeout(open, 600);
  }
}

/* ---------- Toolbar ---------- */

function installToolbar() {
  const toolButtons = document.querySelectorAll("[data-tool]");
  const popovers = document.querySelectorAll(".popover");

  tools.onChange((state) => {
    document.documentElement.dataset.theme = state.theme;
    inkStage.classList.remove(...BACKGROUNDS.map((bg) => `bg-${bg}`));
    if (state.background !== "plain") {
      inkStage.classList.add(`bg-${state.background}`);
    }
    stageWrap.classList.remove(...PAGE_SIZES.map((size) => `size-${size}`));
    if (state.pageSize !== "full") {
      stageWrap.classList.add(`size-${state.pageSize}`);
    }
    for (const button of toolButtons) {
      button.classList.toggle("is-active", button.dataset.tool === state.tool);
    }
    const swatch = document.querySelector("[data-pen-swatch]");
    if (swatch) {
      swatch.style.background = resolveStrokeColor(state.color);
    }
    inkStage.style.cursor = state.tool === "eraser" ? "cell" : state.tool === "text" ? "text" : "crosshair";
  });

  for (const button of toolButtons) {
    button.addEventListener("click", () => {
      const tool = button.dataset.tool;
      if (tool === "highlighter") {
        tools.set({ tool: "highlighter", penType: "highlighter" });
      } else if (tool === "pen") {
        tools.set({ tool: "pen", penType: "pen" });
      } else {
        tools.set({ tool });
      }
      if (button.dataset.popover) {
        togglePopover(button.dataset.popover);
      } else {
        closePopovers();
      }
    });
  }

  document.querySelector("[data-action='undo']").addEventListener("click", () => tools.history.undo());
  document.querySelector("[data-action='redo']").addEventListener("click", () => tools.history.redo());
  document.querySelector("[data-action='theme']").addEventListener("click", () => {
    tools.set({ theme: tools.state.theme === "dark" ? "light" : "dark" });
    scheduleLayout();
    pins.renderPins();
    text.refreshColors();
  });
  document.querySelector("[data-popover='page-popover']").addEventListener("click", () => togglePopover("page-popover"));

  buildSwatches(document.querySelector("[data-pen-colors]"), PEN_COLORS, () => tools.state.color, (id) => tools.set({ color: id }));
  buildPills(document.querySelector("[data-pen-sizes]"), PEN_SIZES.map((s) => ({ id: String(s.value), label: s.label })), () => String(tools.state.size), (id) => tools.set({ size: Number(id) }));
  buildPills(document.querySelector("[data-text-fonts]"), FONTS, () => tools.state.font, (id) => tools.set({ font: id }));
  buildSwatches(document.querySelector("[data-text-colors]"), PEN_COLORS, () => tools.state.textColor, (id) => tools.set({ textColor: id }));
  buildPills(document.querySelector("[data-backgrounds]"), BACKGROUNDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })), () => tools.state.background, (id) => tools.set({ background: id }));
  buildPills(document.querySelector("[data-page-sizes]"), PAGE_SIZES.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) })), () => tools.state.pageSize, (id) => tools.set({ pageSize: id }));

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".popover, .tool-button, .chip-button")) {
      closePopovers();
    }
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    if (event.key === "z" || event.key === "Z") {
      event.preventDefault();
      if (event.shiftKey) {
        tools.history.redo();
      } else {
        tools.history.undo();
      }
    } else if (event.key === "y" || event.key === "Y") {
      event.preventDefault();
      tools.history.redo();
    }
  });

  function togglePopover(id) {
    for (const popover of popovers) {
      popover.hidden = popover.id === id ? !popover.hidden : true;
    }
  }

  function closePopovers() {
    for (const popover of popovers) {
      popover.hidden = true;
    }
  }
}

function buildSwatches(container, colors, getActive, onPick) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  for (const color of colors) {
    const button = document.createElement("button");
    button.className = "swatch";
    button.type = "button";
    button.title = color.label;
    button.style.background = color.id === "auto"
      ? "linear-gradient(135deg, #2A2A26 50%, #ECE9E2 50%)"
      : color.value;
    button.addEventListener("click", () => {
      onPick(color.id);
      refresh();
    });
    container.appendChild(button);
  }
  refresh();
  function refresh() {
    const active = getActive();
    let index = 0;
    for (const child of container.children) {
      child.classList.toggle("is-active", colors[index].id === active);
      index += 1;
    }
  }
}

function buildPills(container, options, getActive, onPick) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  for (const option of options) {
    const button = document.createElement("button");
    button.className = "option-pill";
    button.type = "button";
    button.textContent = option.label;
    button.addEventListener("click", () => {
      onPick(option.id);
      refresh();
    });
    container.appendChild(button);
  }
  refresh();
  function refresh() {
    const active = getActive();
    let index = 0;
    for (const child of container.children) {
      child.classList.toggle("is-active", options[index].id === active);
      index += 1;
    }
  }
}

/* ---------- Question band ---------- */

function installQuestionBand(band, pinControls) {
  if (!band) {
    return;
  }

  const image = band.querySelector(".question-image");
  const preview = band.querySelector(".question-preview");
  const input = band.querySelector("#question-input");
  const savedQuestion = window.localStorage.getItem("kairo.questionImage");

  setQuestionImage(savedQuestion || "./assets/demo-question.png");

  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    readImageFile(file);
  });

  // Paste screenshots / question papers straight from the clipboard.
  window.addEventListener("paste", (event) => {
    const items = event.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        readImageFile(item.getAsFile());
        return;
      }
    }
  });

  preview?.addEventListener("click", () => {
    if (image.src) {
      pinControls.showImageOverlay(image.src, image.alt);
    }
  });

  preview?.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && image.src) {
      event.preventDefault();
      pinControls.showImageOverlay(image.src, image.alt);
    }
  });

  function readImageFile(file) {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      if (dataUrl) {
        try {
          window.localStorage.setItem("kairo.questionImage", dataUrl);
        } catch {
          // Image too large for localStorage: still show it for this session.
        }
        setQuestionImage(dataUrl);
      }
    });
    reader.readAsDataURL(file);
  }

  function setQuestionImage(src) {
    if (!image) {
      return;
    }
    image.src = src;
    image.hidden = false;
  }
}

function installServiceWorker() {
  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
