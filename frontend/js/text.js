import { resolveStrokeColor } from "./render.js";

const QUESTION_PATTERN = /\?|^\s*q(uestion)?\s*\d*[.:)]/i;

export function installText({ stage, tools, onChanged = () => {} }) {
  const layer = document.createElement("div");
  layer.className = "text-layer";
  stage.appendChild(layer);
  let nextId = 1;

  function addTextBox(point, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "text-box";
    wrap.dataset.textId = `text-${nextId}`;
    nextId += 1;
    wrap.style.left = `${point.x}px`;
    wrap.style.top = `${point.y}px`;

    const editable = document.createElement("div");
    editable.className = "text-box-input";
    editable.contentEditable = "true";
    editable.spellcheck = false;
    editable.style.fontFamily = options.fontStack || tools.getFontStack();
    editable.style.color = resolveStrokeColor(options.color || tools.state.textColor);
    editable.dataset.colorId = options.color || tools.state.textColor;
    if (options.text) {
      editable.textContent = options.text;
    }

    const remove = document.createElement("button");
    remove.className = "text-box-remove";
    remove.type = "button";
    remove.title = "Delete text";
    remove.textContent = "×";

    wrap.appendChild(editable);
    wrap.appendChild(remove);
    layer.appendChild(wrap);

    function destroy() {
      wrap.remove();
    }

    remove.addEventListener("pointerdown", (event) => event.stopPropagation());
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      const snapshot = snapshotOf(wrap, editable);
      destroy();
      tools.history.push({
        undo: () => addTextBox(snapshot.point, snapshot),
        redo: () => {
          const again = layer.querySelector(`[data-text-id="${wrap.dataset.textId}"]`);
          if (again) {
            again.remove();
          }
        }
      });
    });

    editable.addEventListener("blur", () => {
      if (!editable.textContent.trim()) {
        destroy();
        onChanged();
        return;
      }
      // Typed questions are detected automatically ("...?", "Q1.", "Question 2:").
      wrap.classList.toggle("is-question", QUESTION_PATTERN.test(editable.textContent));
      onChanged();
    });

    wrap.addEventListener("pointerdown", (event) => event.stopPropagation());

    if (!options.silent) {
      window.setTimeout(() => editable.focus(), 0);
      tools.history.push({
        undo: () => destroy(),
        redo: () => layer.appendChild(wrap)
      });
    }

    return wrap;
  }

  function refreshColors() {
    for (const editable of layer.querySelectorAll(".text-box-input")) {
      editable.style.color = resolveStrokeColor(editable.dataset.colorId || "auto");
    }
  }

  function serialize() {
    return [...layer.querySelectorAll(".text-box")].map((wrap) => {
      const editable = wrap.querySelector(".text-box-input");
      return {
        point: { x: parseFloat(wrap.style.left), y: parseFloat(wrap.style.top) },
        text: editable.textContent,
        fontStack: editable.style.fontFamily,
        color: editable.dataset.colorId || "auto"
      };
    }).filter((box) => box.text.trim());
  }

  function load(records) {
    layer.replaceChildren();
    for (const record of records || []) {
      const wrap = addTextBox(record.point, { ...record, silent: true });
      wrap.classList.toggle("is-question", QUESTION_PATTERN.test(record.text || ""));
    }
    onChanged();
  }

  function getQuestionText() {
    const box = layer.querySelector(".text-box.is-question .text-box-input");
    return box ? box.textContent.trim() : null;
  }

  return { addTextBox, refreshColors, serialize, load, getQuestionText };
}

function snapshotOf(wrap, editable) {
  return {
    point: { x: parseFloat(wrap.style.left), y: parseFloat(wrap.style.top) },
    text: editable.textContent,
    fontStack: editable.style.fontFamily,
    color: editable.dataset.colorId
  };
}
