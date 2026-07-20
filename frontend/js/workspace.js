const INDEX_KEY = "kairo.notes";
const PAGE_PREFIX = "kairo.page.";

export const LABEL_COLORS = [
  { id: "sage", value: "#7C9A72" },
  { id: "clay", value: "#B08463" },
  { id: "sky", value: "#7C97B0" },
  { id: "plum", value: "#9A82AC" },
  { id: "gold", value: "#C7A253" },
  { id: "rose", value: "#B87E7E" }
];

export function installWorkspace({ serializePage, loadPage, clearPage }) {
  const index = readIndex();
  const state = {
    notes: index.notes,
    folders: index.folders,
    noteId: null,
    pageIndex: 0,
    dirty: false,
    saveTimer: null
  };

  function readIndex() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(INDEX_KEY));
      if (Array.isArray(raw)) {
        // Migrate the pre-folders format.
        return { folders: [], notes: raw.map((note) => ({ ...note, folderId: note.folderId || null })) };
      }
      return { folders: raw?.folders || [], notes: raw?.notes || [] };
    } catch {
      return { folders: [], notes: [] };
    }
  }

  function writeIndex() {
    try {
      window.localStorage.setItem(INDEX_KEY, JSON.stringify({ folders: state.folders, notes: state.notes }));
    } catch {
      // Storage full or unavailable: keep working in memory.
    }
  }

  function createFolder(parentId = null, name = "New file") {
    const folder = { id: `folder-${Date.now().toString(36)}-${state.folders.length}`, name, parentId, color: null };
    state.folders.push(folder);
    writeIndex();
    return folder;
  }

  function renameFolder(folderId, name) {
    const folder = state.folders.find((candidate) => candidate.id === folderId);
    if (folder) {
      folder.name = name.trim() || "Untitled file";
      writeIndex();
    }
  }

  function setFolderColor(folderId, color) {
    const folder = state.folders.find((candidate) => candidate.id === folderId);
    if (folder) {
      folder.color = color;
      writeIndex();
    }
  }

  function setNoteColor(noteId, color) {
    const note = state.notes.find((candidate) => candidate.id === noteId);
    if (note) {
      note.color = color;
      writeIndex();
    }
  }

  function moveNoteToFolder(noteId, folderId) {
    const note = state.notes.find((candidate) => candidate.id === noteId);
    if (note) {
      note.folderId = folderId;
      writeIndex();
    }
  }

  function deleteFolder(folderId) {
    const folder = state.folders.find((candidate) => candidate.id === folderId);
    if (!folder) {
      return;
    }
    // Children and notes move up to the deleted folder's parent.
    for (const child of state.folders) {
      if (child.parentId === folderId) {
        child.parentId = folder.parentId;
      }
    }
    for (const note of state.notes) {
      if (note.folderId === folderId) {
        note.folderId = folder.parentId;
      }
    }
    state.folders = state.folders.filter((candidate) => candidate.id !== folderId);
    writeIndex();
  }

  function currentNote() {
    return state.notes.find((note) => note.id === state.noteId) || null;
  }

  function createNote(title = "Untitled note", folderId = null) {
    const note = {
      id: `note-${Date.now().toString(36)}`,
      title,
      folderId,
      color: null,
      pageIds: [`page-${Date.now().toString(36)}`],
      updatedAt: Date.now()
    };
    state.notes.unshift(note);
    writeIndex();
    return note;
  }

  function deleteNote(noteId) {
    const note = state.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return;
    }
    for (const pageId of note.pageIds) {
      try {
        window.localStorage.removeItem(PAGE_PREFIX + pageId);
      } catch {
        // Ignore storage errors on cleanup.
      }
    }
    state.notes = state.notes.filter((candidate) => candidate.id !== noteId);
    writeIndex();
  }

  function openNote(noteId, pageIndex = 0) {
    saveNow();
    const note = state.notes.find((candidate) => candidate.id === noteId);
    if (!note) {
      return false;
    }
    state.noteId = noteId;
    state.pageIndex = Math.min(pageIndex, note.pageIds.length - 1);
    loadCurrentPage();
    return true;
  }

  function closeNote() {
    saveNow();
    state.noteId = null;
  }

  function renameNote(title) {
    const note = currentNote();
    if (note) {
      note.title = title.trim() || "Untitled note";
      note.updatedAt = Date.now();
      writeIndex();
    }
  }

  function pageCount() {
    return currentNote()?.pageIds.length || 1;
  }

  function addPage() {
    const note = currentNote();
    if (!note) {
      return;
    }
    saveNow();
    note.pageIds.splice(state.pageIndex + 1, 0, `page-${Date.now().toString(36)}`);
    state.pageIndex += 1;
    note.updatedAt = Date.now();
    writeIndex();
    loadCurrentPage();
  }

  function deletePage(indexToDelete = state.pageIndex) {
    const note = currentNote();
    if (!note || note.pageIds.length <= 1) {
      return false;
    }
    const [removedId] = note.pageIds.splice(indexToDelete, 1);
    try {
      window.localStorage.removeItem(PAGE_PREFIX + removedId);
    } catch {
      // Ignore storage errors on cleanup.
    }
    if (state.pageIndex >= note.pageIds.length) {
      state.pageIndex = note.pageIds.length - 1;
    } else if (indexToDelete < state.pageIndex) {
      state.pageIndex -= 1;
    }
    note.updatedAt = Date.now();
    writeIndex();
    loadCurrentPage();
    return true;
  }

  function switchPage(delta) {
    switchToPage(state.pageIndex + delta);
  }

  function switchToPage(indexTarget) {
    const note = currentNote();
    if (!note || indexTarget < 0 || indexTarget >= note.pageIds.length || indexTarget === state.pageIndex) {
      return;
    }
    saveNow();
    state.pageIndex = indexTarget;
    loadCurrentPage();
  }

  function loadCurrentPage() {
    const note = currentNote();
    if (!note) {
      return;
    }
    const pageId = note.pageIds[state.pageIndex];
    let payload = null;
    try {
      payload = JSON.parse(window.localStorage.getItem(PAGE_PREFIX + pageId));
    } catch {
      payload = null;
    }
    if (payload) {
      loadPage(payload);
    } else {
      clearPage();
    }
    state.dirty = false;
  }

  function markDirty() {
    if (!state.noteId) {
      return;
    }
    state.dirty = true;
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(saveNow, 900);
  }

  function saveNow() {
    const note = currentNote();
    if (!note || !state.dirty) {
      return;
    }
    const pageId = note.pageIds[state.pageIndex];
    try {
      window.localStorage.setItem(PAGE_PREFIX + pageId, JSON.stringify(serializePage()));
      note.updatedAt = Date.now();
      writeIndex();
    } catch {
      // Storage full: nothing sensible to do client-side; keep working.
    }
    state.dirty = false;
  }

  window.addEventListener("beforeunload", saveNow);

  return {
    get notes() {
      return state.notes;
    },
    get folders() {
      return state.folders;
    },
    get pageIndex() {
      return state.pageIndex;
    },
    currentNote,
    createNote,
    deleteNote,
    openNote,
    closeNote,
    renameNote,
    createFolder,
    renameFolder,
    deleteFolder,
    setFolderColor,
    setNoteColor,
    moveNoteToFolder,
    pageCount,
    addPage,
    deletePage,
    switchPage,
    switchToPage,
    markDirty,
    saveNow
  };
}
