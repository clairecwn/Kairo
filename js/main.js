import { createInkSurface } from "./ink.js";
import { installAi } from "./ai.js";
import { installCommitController } from "./commit.js";
import { installImages } from "./images.js";
import { installLayout, scheduleLayout } from "./layout.js";
import { installPins } from "./pins.js";
import { installText } from "./text.js";
import { installTools, FONTS, BACKGROUNDS, PAGE_SIZES } from "./tools.js";
import { installWorkspace } from "./workspace.js";
import { PEN_COLORS, PEN_SIZES, resolveStrokeColor } from "./render.js";
import {
  assignStroke,
  assignStrokeToLine,
  createNewLineForStroke,
  getLastAssignment,
  getLines,
  loadLines,
  removeStrokeFromLine,
  restoreLine,
  serializeLines,
  setLineKeyResult,
  setLineText
} from "./lines.js";
import {
  addStroke as addStoredStroke,
  getStrokes,
  loadStrokes,
  removeStroke as removeStoredStroke,
  restoreStroke,
  serializeStrokes
} from "./store.js";

const committedCanvas = document.querySelector("#committed-canvas");
const wetCanvas = document.querySelector("#wet-canvas");
const inkStage = document.querySelector(".ink-stage");
const stageWrap = document.querySelector(".stage-wrap");
const homeScreen = document.querySelector(".home-screen");
const noteTitleInput = document.querySelector(".note-title");
const sidePanel = document.querySelector(".side-panel");

const tools = installTools();

const layout = installLayout({
  stage: inkStage,
  getLines,
  getStrokes,
  getCompactMode: () => tools.state.compact
});
const pins = installPins({
  stage: inkStage,
  layout,
  getLines,
  getStrokes,
  isSelectionAllowed: () => tools.getTool() === "pen" || tools.getTool() === "highlighter",
  onDeleteLines: deleteLines,
  onBeforeSelect: () => inkSurface?.cancelActive(),
  onAfterSelect: (lineId) => {
    commit.commitLine(lineId);
    layout.unfreezeLine(lineId);
  },
  onPinsChanged: () => workspace.markDirty()
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
  onPenLift: () => {
    ai.handlePenLift();
    pins.renderPins();
    workspace.markDirty();
  }
});
layout.setLineDyProvider(commit.getLineDy);

const text = installText({
  stage: inkStage,
  tools,
  onChanged: () => {
    recomputeQuestion();
    workspace.markDirty();
  }
});

const images = installImages({
  stage: inkStage,
  onChange: (questionImage, dirty) => {
    recomputeQuestion();
    if (dirty) {
      workspace.markDirty();
    }
  }
});

// The app decides what the "question" is: a Q-flagged image wins, otherwise
// the first typed text that reads like a question ("...?", "Q1.", "Question 2:").
function recomputeQuestion() {
  const questionImage = images.getQuestion();
  if (questionImage) {
    pins.setQuestion({ type: "image", src: questionImage.src });
    return;
  }
  const questionText = text.getQuestionText();
  pins.setQuestion(questionText ? { type: "text", text: questionText } : null);
}

const workspace = installWorkspace({
  serializePage: () => ({
    strokes: serializeStrokes(),
    lines: serializeLines(),
    commit: commit.serialize(),
    pins: pins.serializePins(),
    texts: text.serialize(),
    images: images.serialize()
  }),
  loadPage: (payload) => {
    loadStrokes(payload.strokes);
    loadLines(payload.lines);
    commit.load(payload.commit);
    pins.loadPins(payload.pins);
    text.load(payload.texts);
    images.load(payload.images);
    recomputeQuestion();
    layout.scheduleLayout();
    refreshWorkspaceUi();
  },
  clearPage: () => {
    loadStrokes([]);
    loadLines([]);
    commit.load(null);
    pins.loadPins([]);
    text.load([]);
    images.load([]);
    recomputeQuestion();
    layout.scheduleLayout();
    refreshWorkspaceUi();
  }
});

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
      workspace.markDirty();
      return id;
    },
    getStrokes
  },
  onErase: eraseAt,
  onTextPoint: (point) => {
    text.addTextBox(point);
    workspace.markDirty();
  }
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
  workspace.markDirty();
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
  workspace.markDirty();
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
installPager();
installSidebar();
installImageIntake();
installHomeScreen();
installServiceWorker();

// Debug/inspection hook (used by automated tests).
window.getLines = getLines;

/* ---------- Image intake (upload + paste straight onto the page) ---------- */

function installImageIntake() {
  const input = document.querySelector("#image-input");
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file && file.type.startsWith("image/")) {
      readImageFile(file);
      input.value = "";
    }
  });

  window.addEventListener("paste", (event) => {
    if (event.target.closest?.(".text-box-input, .note-title, .pin-card-caption")) {
      return;
    }
    const items = event.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        readImageFile(item.getAsFile());
        return;
      }
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
        images.insert(dataUrl);
      }
    });
    reader.readAsDataURL(file);
  }
}

/* ---------- Side panel: pages + folders ---------- */

function installSidebar() {
  document.querySelector("[data-action='sidebar']").addEventListener("click", () => {
    sidePanel.hidden = !sidePanel.hidden;
    if (!sidePanel.hidden) {
      renderSidebar();
    }
  });
  sidePanel.querySelector("[data-side='add-page']").addEventListener("click", () => {
    workspace.addPage();
    refreshWorkspaceUi();
  });
  sidePanel.querySelector("[data-side='add-note']").addEventListener("click", () => {
    const note = workspace.createNote();
    workspace.openNote(note.id);
    noteTitleInput.value = note.title;
    refreshWorkspaceUi();
  });
  sidePanel.querySelector("[data-side='add-folder']").addEventListener("click", () => {
    workspace.createFolder(null);
    renderSidebar();
  });
}

function renderSidebar() {
  if (sidePanel.hidden) {
    return;
  }
  const pagesEl = sidePanel.querySelector(".side-pages");
  pagesEl.replaceChildren();
  const count = workspace.pageCount();
  for (let index = 0; index < count; index += 1) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "side-page-row";
    row.classList.toggle("is-active", index === workspace.pageIndex);
    row.textContent = `Page ${index + 1}`;
    row.addEventListener("click", () => {
      workspace.switchToPage(index);
      refreshWorkspaceUi();
    });
    pagesEl.appendChild(row);
  }

  const tree = sidePanel.querySelector(".side-tree");
  tree.replaceChildren();
  renderFolderChildren(tree, null, 0);
}

function renderFolderChildren(container, parentId, depth) {
  for (const folder of workspace.folders.filter((f) => (f.parentId || null) === parentId)) {
    container.appendChild(renderFolderRow(folder, depth));
    renderFolderChildren(container, folder.id, depth + 1);
  }
  for (const note of workspace.notes.filter((n) => (n.folderId || null) === parentId)) {
    container.appendChild(renderNoteRow(note, depth));
  }
}

function renderFolderRow(folder, depth) {
  const row = document.createElement("div");
  row.className = "side-folder-row";
  row.style.paddingLeft = `${10 + depth * 16}px`;

  const name = document.createElement("span");
  name.className = "side-folder-name";
  name.textContent = folder.name;
  name.title = "Double-click to rename";
  name.addEventListener("dblclick", () => {
    name.contentEditable = "true";
    name.focus();
    document.getSelection()?.selectAllChildren(name);
  });
  name.addEventListener("blur", () => {
    name.contentEditable = "false";
    workspace.renameFolder(folder.id, name.textContent);
    renderSidebar();
  });
  name.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      name.blur();
    }
  });

  const addNote = sideIconButton("＋", "New note in folder", () => {
    const note = workspace.createNote("Untitled note", folder.id);
    workspace.openNote(note.id);
    noteTitleInput.value = note.title;
    refreshWorkspaceUi();
  });
  const addSub = sideIconButton("📁", "New sub-folder", () => {
    workspace.createFolder(folder.id);
    renderSidebar();
  });
  const del = sideIconButton("×", "Delete folder (contents move up)", () => {
    workspace.deleteFolder(folder.id);
    renderSidebar();
  });

  row.append(folderGlyph(), name, addNote, addSub, del);
  return row;
}

function renderNoteRow(note, depth) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "side-note-row";
  row.classList.toggle("is-active", workspace.currentNote()?.id === note.id);
  row.style.paddingLeft = `${14 + depth * 16}px`;
  row.textContent = note.title;
  row.addEventListener("click", () => {
    workspace.openNote(note.id);
    noteTitleInput.value = note.title;
    refreshWorkspaceUi();
  });
  return row;
}

function folderGlyph() {
  const glyph = document.createElement("span");
  glyph.className = "side-folder-glyph";
  glyph.textContent = "▸";
  return glyph;
}

function sideIconButton(label, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "side-icon-button";
  button.title = title;
  button.setAttribute("aria-label", title);
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function refreshWorkspaceUi() {
  updatePager();
  renderSidebar();
}

/* ---------- Home screen ---------- */

function installHomeScreen() {
  const grid = homeScreen.querySelector(".home-grid");
  const newButton = homeScreen.querySelector(".home-new");

  function renderGrid() {
    grid.replaceChildren();
    for (const note of workspace.notes) {
      const card = document.createElement("button");
      card.className = "home-card";
      card.type = "button";
      const updated = new Date(note.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      card.innerHTML = `<span class="home-card-title"></span><span class="home-card-meta">${note.pageIds.length} page${note.pageIds.length > 1 ? "s" : ""} · ${updated}</span>`;
      card.querySelector(".home-card-title").textContent = note.title;
      card.addEventListener("click", () => enterNote(note.id));

      const remove = document.createElement("span");
      remove.className = "home-card-remove";
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", `Delete ${note.title}`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        workspace.deleteNote(note.id);
        renderGrid();
      });
      card.appendChild(remove);
      grid.appendChild(card);
    }
  }

  function enterNote(noteId) {
    workspace.openNote(noteId);
    noteTitleInput.value = workspace.currentNote()?.title || "Untitled note";
    homeScreen.hidden = true;
    refreshWorkspaceUi();
    if (!window.localStorage.getItem("kairo.tourDone")) {
      window.setTimeout(() => window.dispatchEvent(new Event("kairo:start-tour")), 400);
    }
  }

  newButton.addEventListener("click", () => {
    const note = workspace.createNote();
    enterNote(note.id);
    noteTitleInput.focus();
    noteTitleInput.select();
  });

  document.querySelector("[data-action='home']").addEventListener("click", () => {
    workspace.saveNow();
    workspace.closeNote();
    renderGrid();
    homeScreen.hidden = false;
  });

  noteTitleInput.addEventListener("change", () => {
    workspace.renameNote(noteTitleInput.value);
    renderSidebar();
  });
  noteTitleInput.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      noteTitleInput.blur();
    }
  });

  renderGrid();
  homeScreen.hidden = false;
}

/* ---------- Pager ---------- */

function installPager() {
  document.querySelector("[data-page='prev']").addEventListener("click", () => {
    workspace.switchPage(-1);
    refreshWorkspaceUi();
  });
  document.querySelector("[data-page='next']").addEventListener("click", () => {
    workspace.switchPage(1);
    refreshWorkspaceUi();
  });
  document.querySelector("[data-page='add']").addEventListener("click", () => {
    workspace.addPage();
    refreshWorkspaceUi();
  });
  updatePager();
}

function updatePager() {
  const label = document.querySelector(".page-pager-label");
  if (label) {
    label.textContent = `${workspace ? workspace.pageIndex + 1 : 1} / ${workspace ? workspace.pageCount() : 1}`;
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
      button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
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
  buildPills(
    document.querySelector("[data-compact-modes]"),
    [{ id: "auto", label: "Auto (when full)" }, { id: "off", label: "Never" }],
    () => tools.state.compact,
    (id) => {
      tools.set({ compact: id });
      scheduleLayout();
    }
  );

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

  installTour();

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

/* ---------- Walkthrough tour ---------- */

function installTour() {
  const steps = [
    {
      target: ".ink-stage",
      title: "Drop your question right on the page",
      body: "Paste (Ctrl+V) or insert your question, practice paper, or tutorial. Kairo spots the question — image or typed — and keeps it one tap away in the right rail while you work."
    },
    {
      target: ".ink-stage",
      title: "Just write — no timers",
      body: "Ink stays exactly where you put it. Start a new line by returning to the left margin and dropping down. To fix an earlier line, just write on it."
    },
    {
      target: ".tool-groups",
      title: "Your toolkit",
      body: "Pens and colors, highlighter, eraser, text boxes, undo/redo — plus paper styles, page width, and dark mode."
    },
    {
      target: ".page-pager",
      title: "Pages and notes",
      body: "Add pages with ＋ and flip between them. The home button takes you back to all your notes — everything saves automatically."
    },
    {
      target: ".ink-stage",
      title: "Pin key results",
      body: "Tap a written line to select it, drag the round handles to include neighbours, then Pin — or delete. Hover a card to read it full-size while you keep writing, and label it below."
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
    popover.style.top = below + 200 < window.innerHeight ? `${below}px` : "90px";
    popover.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 380))}px`;
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
  window.addEventListener("kairo:start-tour", open);
}

function installServiceWorker() {
  if ("serviceWorker" in navigator && window.location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}
