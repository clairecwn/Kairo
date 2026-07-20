const LINE_ADVANCE_RATIO = 0.78;

export function installCommitController(options) {
  const {
    stage,
    addStroke,
    assignStroke,
    assignStrokeToLine,
    createNewLineForStroke,
    getLastAssignment,
    getLines,
    layout,
    isDrawingTool = () => true,
    onLineCommit = () => {},
    onPenLift = () => {}
  } = options;

  const state = {
    openLineId: null,
    committedLineIds: new Set(),
    reentry: null,
    // Per-line vertical offset: docY = screenY + dy. Keeps document space
    // monotonically ordered while the ink displays exactly where it was written.
    lineDy: new Map(),
    docCursor: 0
  };

  function getLineDy(lineId) {
    return state.lineDy.get(lineId) || 0;
  }

  function openLine() {
    return getLines().find((line) => line.id === state.openLineId) || null;
  }

  function addCommittedStroke(points, style) {
    if (state.reentry) {
      const mappedPoints = points.map((point) => mapPointThroughInverse(point, state.reentry.transform));
      const id = addStroke(mappedPoints, style);
      assignStrokeToLine({ id, points: mappedPoints }, state.reentry.lineId);
      state.openLineId = state.reentry.lineId;
      syncLayoutState();
      return id;
    }

    const active = openLine();
    const first = points[0];
    const startsNew = active
      ? classifiesAsNewLine({ x: first[0], y: first[1] }, active)
      : true;

    let dy = 0;
    if (active && !startsNew) {
      dy = getLineDy(active.id);
    } else if (getLines().length > 0) {
      dy = state.docCursor - first[1];
    }

    const mappedPoints = dy === 0
      ? points
      : points.map(([x, y, pressure, t]) => [x, y + dy, pressure, t]);
    const id = addStroke(mappedPoints, style);

    if (active && startsNew) {
      createNewLineForStroke({ id, points: mappedPoints });
      state.lineDy.set(getLastAssignment().lineId, dy);
      commitLine(active.id);
    } else {
      assignStroke({ id, points: mappedPoints });
      const assignment = getLastAssignment();
      if (assignment?.isNewLine) {
        state.lineDy.set(assignment.lineId, dy);
        if (assignment.previousLineId) {
          commitLine(assignment.previousLineId);
        }
      }
    }

    const assignment = getLastAssignment();
    if (assignment?.lineId) {
      state.openLineId = assignment.lineId;
    }
    advanceDocCursor();
    syncLayoutState();
    return id;
  }

  function advanceDocCursor() {
    const lines = getLines();
    const last = lines[lines.length - 1];
    if (!last) {
      return;
    }
    const lineHeight = Math.max(24, last.bbox.height);
    state.docCursor = Math.max(
      state.docCursor,
      last.baseline + lineHeight * LINE_ADVANCE_RATIO + 1
    );
  }

  // Screen-space new-line rules: (a) pen returned left AND dropped at least 0.7
  // line-heights below the current baseline, or (b) pen returned left into free
  // space well above the current line (the user hopped back up after compaction),
  // or (c) the pen landed far outside the current line's band either way.
  function classifiesAsNewLine(point, line) {
    const dy = getLineDy(line.id);
    const screenTop = line.bbox.minY - dy;
    const screenBaseline = line.baseline - dy;
    const lineHeight = Math.max(24, line.bbox.height);
    const returnedLeft = point.x <= line.startX + lineHeight * 0.4;
    const below = point.y >= screenBaseline + lineHeight * 0.7;
    const aboveGap = point.y <= screenTop - lineHeight * 0.7;
    const farAway = point.y >= screenBaseline + lineHeight * 1.5
      || point.y <= screenTop - lineHeight * 1.5;
    return (returnedLeft && (below || aboveGap)) || farAway;
  }

  function handlePointerDown(event) {
    if (!isDrawingTool()) {
      return;
    }
    if (event.target.closest?.(".pin-column, .line-pin-button, .line-delete-button, .selection-handle, .pin-overlay, .text-box, .tour-layer")) {
      return;
    }
    const point = pointFromEvent(event);
    if (state.reentry && !isPointInReentry(point)) {
      commitLine(state.reentry.lineId);
      layout.unfreezeLine(state.reentry.lineId);
      state.reentry = null;
    }

    const active = openLine();
    if (active && classifiesAsNewLine(point, active)) {
      commitLine(active.id);
    }

    const hit = layout.hitTestLine(point, [...state.committedLineIds]);
    if (hit) {
      state.reentry = hit;
      state.openLineId = hit.lineId;
      state.committedLineIds.delete(hit.lineId);
      layout.freezeLine(hit.lineId);
      syncLayoutState();
    } else if (state.reentry) {
      commitLine(state.reentry.lineId);
      layout.unfreezeLine(state.reentry.lineId);
      state.reentry = null;
    }
  }

  function commitLine(lineId) {
    if (!lineId) {
      return;
    }
    state.committedLineIds.add(lineId);
    if (state.openLineId === lineId) {
      state.openLineId = null;
    }
    syncLayoutState();
    onLineCommit(lineId);
  }

  function syncLayoutState() {
    layout.setCommitState({
      openLineId: state.openLineId,
      committedLineIds: [...state.committedLineIds]
    });
  }

  function pointFromEvent(event) {
    const rect = stage.getBoundingClientRect();
    const scale = rect.width > 0 ? stage.offsetWidth / rect.width : 1;
    return {
      x: (event.clientX - rect.left) * scale,
      y: (event.clientY - rect.top) * scale
    };
  }

  function isPointInReentry(point) {
    const { transform } = state.reentry;
    const width = transform.bbox.width * transform.scale;
    const height = transform.bbox.height * transform.scale;
    return point.x >= transform.x
      && point.x <= transform.x + width
      && point.y >= transform.y
      && point.y <= transform.y + height;
  }

  function handlePenLift(event) {
    // Pen lifts only count on the writing surface, not on cards/buttons/text UI.
    if (event.target.closest?.(".pin-column, .line-action-bar, .selection-handle, .pin-overlay, .text-box, .popover, .page-pager")) {
      return;
    }
    onPenLift(event);
  }

  stage.addEventListener("pointerdown", handlePointerDown, true);
  stage.addEventListener("pointerup", handlePenLift);

  function serialize() {
    return {
      openLineId: state.openLineId,
      committedLineIds: [...state.committedLineIds],
      lineDy: [...state.lineDy.entries()],
      docCursor: state.docCursor
    };
  }

  function load(data) {
    state.openLineId = data?.openLineId || null;
    state.committedLineIds = new Set(data?.committedLineIds || []);
    state.lineDy = new Map(data?.lineDy || []);
    state.docCursor = data?.docCursor || 0;
    state.reentry = null;
    syncLayoutState();
  }

  return {
    addStroke: addCommittedStroke,
    commitLine,
    getLineDy,
    serialize,
    load,
    destroy() {
      stage.removeEventListener("pointerdown", handlePointerDown, true);
      stage.removeEventListener("pointerup", handlePenLift);
    }
  };
}

function mapPointThroughInverse(point, transform) {
  const [x, y, pressure, t] = point;
  return [
    transform.bbox.minX + (x - transform.x) / transform.scale,
    transform.bbox.minY + (y - transform.y) / transform.scale,
    pressure,
    t
  ];
}
