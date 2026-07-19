const STORAGE_KEY = "kairo.tools";

export const FONTS = [
  { id: "sans", label: "Sans", stack: "Inter, ui-sans-serif, system-ui, sans-serif" },
  { id: "serif", label: "Serif", stack: "Georgia, 'Times New Roman', serif" },
  { id: "hand", label: "Hand", stack: "'Segoe Print', 'Comic Sans MS', cursive" },
  { id: "mono", label: "Mono", stack: "Consolas, 'Courier New', monospace" }
];

export const BACKGROUNDS = ["plain", "ruled", "grid", "dots"];
export const PAGE_SIZES = ["full", "medium", "narrow"];

export function installTools() {
  const saved = readSaved();
  const state = {
    tool: "pen",
    penType: saved.penType || "pen",
    color: saved.color || "auto",
    size: saved.size || 5.8,
    font: saved.font || "sans",
    textColor: saved.textColor || "auto",
    theme: saved.theme || "light",
    background: saved.background || "ruled",
    pageSize: saved.pageSize || "full"
  };
  const listeners = new Set();

  const history = {
    undoStack: [],
    redoStack: [],
    push(action) {
      this.undoStack.push(action);
      if (this.undoStack.length > 200) {
        this.undoStack.shift();
      }
      this.redoStack = [];
      emit();
    },
    undo() {
      const action = this.undoStack.pop();
      if (action) {
        action.undo();
        this.redoStack.push(action);
        emit();
      }
    },
    redo() {
      const action = this.redoStack.pop();
      if (action) {
        action.redo();
        this.undoStack.push(action);
        emit();
      }
    }
  };

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function set(patch) {
    Object.assign(state, patch);
    persist(state);
    emit();
  }

  return {
    state,
    history,
    set,
    onChange(listener) {
      listeners.add(listener);
      listener(state);
    },
    getTool: () => state.tool,
    getPenStyle: () => ({ color: state.color, size: state.size, penType: state.penType }),
    getFontStack: () => (FONTS.find((font) => font.id === state.font) || FONTS[0]).stack
  };
}

function readSaved() {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function persist(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      penType: state.penType,
      color: state.color,
      size: state.size,
      font: state.font,
      textColor: state.textColor,
      theme: state.theme,
      background: state.background,
      pageSize: state.pageSize
    }));
  } catch {
    // Storage unavailable (private mode): run with in-memory settings.
  }
}
