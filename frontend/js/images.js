export function installImages({ stage, onChange = () => {} }) {
  // Visuals live BELOW the ink canvases so students can write directly on top
  // of a pasted question paper; the controls live in a layer above the ink.
  const visualLayer = document.createElement("div");
  visualLayer.className = "image-layer";
  stage.appendChild(visualLayer);

  const chromeLayer = document.createElement("div");
  chromeLayer.className = "image-chrome-layer";
  stage.appendChild(chromeLayer);

  const items = [];
  let nextId = 1;

  function insert(src, options = {}) {
    const item = {
      id: options.id || `image-${Date.now().toString(36)}-${nextId}`,
      src,
      x: options.x ?? 24,
      y: options.y ?? 16,
      w: options.w ?? Math.min(560, stage.clientWidth - 220),
      // The first image dropped on a page is almost always the question /
      // tutorial sheet — flag it automatically; the badge toggles it.
      isQuestion: options.isQuestion ?? items.length === 0
    };
    nextId += 1;
    items.push(item);
    render(item);
    if (!options.silent) {
      emit();
    }
    return item;
  }

  function render(item) {
    const img = document.createElement("img");
    img.className = "page-image";
    img.src = item.src;
    img.alt = item.isQuestion ? "Question" : "Inserted image";
    img.draggable = false;
    visualLayer.appendChild(img);

    const chrome = document.createElement("div");
    chrome.className = "image-chrome";
    chrome.innerHTML = `
      <div class="image-chrome-bar">
        <span class="image-drag" title="Drag to move">⠿</span>
        <button type="button" class="image-q" title="Mark as the question">Q</button>
        <button type="button" class="image-remove" title="Remove image">×</button>
      </div>
      <span class="image-resize" title="Drag to resize"></span>`;
    chromeLayer.appendChild(chrome);

    item._img = img;
    item._chrome = chrome;
    position(item);

    const drag = chrome.querySelector(".image-drag");
    const resize = chrome.querySelector(".image-resize");
    const qBadge = chrome.querySelector(".image-q");
    const remove = chrome.querySelector(".image-remove");
    qBadge.classList.toggle("is-on", item.isQuestion);

    installDrag(drag, (dx, dy) => {
      item.x += dx;
      item.y += dy;
      position(item);
    });
    installDrag(resize, (dx) => {
      item.w = Math.max(120, item.w + dx);
      position(item);
    });
    drag.addEventListener("pointerup", emit);
    resize.addEventListener("pointerup", emit);

    qBadge.addEventListener("click", (event) => {
      event.stopPropagation();
      item.isQuestion = !item.isQuestion;
      if (item.isQuestion) {
        for (const other of items) {
          if (other !== item && other.isQuestion) {
            other.isQuestion = false;
            other._chrome.querySelector(".image-q").classList.remove("is-on");
          }
        }
      }
      qBadge.classList.toggle("is-on", item.isQuestion);
      emit();
    });
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeItem(item.id);
    });
  }

  function zoomScale() {
    const rect = stage.getBoundingClientRect();
    return rect.width > 0 ? stage.offsetWidth / rect.width : 1;
  }

  function installDrag(handle, apply) {
    let last = null;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      last = { x: event.clientX, y: event.clientY };
    });
    handle.addEventListener("pointermove", (event) => {
      if (!last) {
        return;
      }
      const scale = zoomScale();
      apply((event.clientX - last.x) * scale, (event.clientY - last.y) * scale);
      last = { x: event.clientX, y: event.clientY };
    });
    const end = () => {
      last = null;
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function position(item) {
    item._img.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`;
    item._img.style.width = `${item.w}px`;
    item._chrome.style.transform = `translate3d(${item.x}px, ${item.y}px, 0)`;
    item._chrome.style.width = `${item.w}px`;
    item._chrome.style.height = `${item._img.offsetHeight || item.w * 0.4}px`;
  }

  function removeItem(id) {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      return;
    }
    items[index]._img.remove();
    items[index]._chrome.remove();
    items.splice(index, 1);
    emit();
  }

  function serialize() {
    return items.map((item) => ({
      id: item.id,
      src: item.src,
      x: item.x,
      y: item.y,
      w: item.w,
      isQuestion: item.isQuestion
    }));
  }

  function load(records) {
    for (const item of items) {
      item._img.remove();
      item._chrome.remove();
    }
    items.length = 0;
    for (const record of records || []) {
      insert(record.src, { ...record, silent: true });
    }
    emit(false);
  }

  function getQuestion() {
    return items.find((item) => item.isQuestion) || null;
  }

  function emit(dirty = true) {
    onChange(getQuestion(), dirty);
  }

  return { insert, load, serialize, getQuestion };
}
