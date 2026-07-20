const LINE_GAP_RATIO = 0.7;
const RETURN_LEFT_RATIO = 0.4;
const SAME_LINE_OVERLAP_RATIO = 0.5;
const SMALL_STROKE_HEIGHT_RATIO = 0.55;
const DEFAULT_X_HEIGHT = 24;

let nextLineId = 1;
const lines = [];
const strokeLineIds = new Map();
let forcedLineId = null;
let lastAssignment = null;
let debugEnabled = false;
let debugCanvas = null;
let debugContext = null;
let debugStage = null;

export function assignStroke(stroke) {
  const normalizedStroke = normalizeStroke(stroke);
  if (!normalizedStroke || normalizedStroke.points.length === 0) {
    return null;
  }

  const bbox = getStrokeBbox(normalizedStroke.points);
  const activeLine = lines[lines.length - 1] || null;
  const forcedLine = forcedLineId ? lines.find((line) => line.id === forcedLineId) : null;
  const smallAttachment = findSmallStrokeAttachment(bbox);
  const overlappingLine = findBestOverlappingLine(bbox);
  let line = null;
  let createdLine = false;

  if (forcedLine) {
    line = forcedLine;
  } else if (smallAttachment) {
    line = smallAttachment;
  } else if (overlappingLine) {
    line = overlappingLine;
  } else if (activeLine && !startsNewLine(normalizedStroke, bbox, activeLine)) {
    line = activeLine;
  } else {
    line = createLine();
    createdLine = true;
  }

  attachStrokeToLine(line, normalizedStroke, bbox);
  lastAssignment = {
    lineId: line.id,
    isNewLine: createdLine,
    previousLineId: createdLine && activeLine ? activeLine.id : null
  };
  drawDebug();
  return line.id;
}

export function assignStrokeToLine(stroke, lineId) {
  forcedLineId = lineId;
  try {
    return assignStroke(stroke);
  } finally {
    forcedLineId = null;
  }
}

export function createNewLineForStroke(stroke) {
  const normalizedStroke = normalizeStroke(stroke);
  if (!normalizedStroke || normalizedStroke.points.length === 0) {
    return null;
  }
  const bbox = getStrokeBbox(normalizedStroke.points);
  const previousLine = lines[lines.length - 1] || null;
  const line = createLine();
  attachStrokeToLine(line, normalizedStroke, bbox);
  lastAssignment = {
    lineId: line.id,
    isNewLine: true,
    previousLineId: previousLine ? previousLine.id : null
  };
  drawDebug();
  return line.id;
}

export function serializeLines() {
  return lines
    .filter((line) => line.bbox)
    .map((line) => ({
      id: line.id,
      strokeIds: line.strokeIds.slice(),
      bbox: { ...line.bbox },
      baseline: line.baseline,
      startX: line.startX,
      medianXHeight: line.medianXHeight,
      strokeHeights: line.strokeHeights.slice(),
      text: line.text,
      isKeyResult: line.isKeyResult
    }));
}

export function loadLines(records) {
  lines.length = 0;
  strokeLineIds.clear();
  let maxId = 0;
  for (const record of records || []) {
    const line = {
      id: record.id,
      strokeIds: record.strokeIds.slice(),
      bbox: { ...record.bbox },
      baseline: record.baseline,
      startX: record.startX,
      medianXHeight: record.medianXHeight || DEFAULT_X_HEIGHT,
      strokeHeights: (record.strokeHeights || []).slice(),
      text: record.text || "",
      isKeyResult: Boolean(record.isKeyResult)
    };
    lines.push(line);
    for (const strokeId of line.strokeIds) {
      strokeLineIds.set(strokeId, line.id);
    }
    const numeric = Number(String(record.id).replace("line-", ""));
    if (Number.isFinite(numeric)) {
      maxId = Math.max(maxId, numeric);
    }
  }
  nextLineId = Math.max(nextLineId, maxId + 1);
  lastAssignment = null;
}

export function restoreLine(lineId) {
  let line = lines.find((candidate) => candidate.id === lineId);
  if (!line) {
    line = {
      id: lineId,
      strokeIds: [],
      bbox: null,
      baseline: 0,
      startX: 0,
      medianXHeight: DEFAULT_X_HEIGHT,
      strokeHeights: [],
      text: "",
      isKeyResult: false
    };
    lines.push(line);
  }
  return line.id;
}

export function removeStrokeFromLine(strokeId, remainingStrokes) {
  const lineId = strokeLineIds.get(strokeId);
  if (!lineId) {
    return null;
  }
  const line = lines.find((candidate) => candidate.id === lineId);
  strokeLineIds.delete(strokeId);
  if (!line) {
    return null;
  }
  line.strokeIds = line.strokeIds.filter((id) => id !== strokeId);

  if (line.strokeIds.length === 0) {
    lines.splice(lines.indexOf(line), 1);
    drawDebug();
    return { lineId, lineRemoved: true };
  }

  const ownStrokes = remainingStrokes.filter((stroke) => line.strokeIds.includes(stroke.id));
  line.bbox = null;
  line.strokeHeights = [];
  for (const stroke of ownStrokes) {
    const bbox = getStrokeBbox(stroke.points);
    line.bbox = line.bbox ? mergeBbox(line.bbox, bbox) : { ...bbox };
    line.strokeHeights.push(Math.max(1, bbox.height));
  }
  line.strokeHeights.sort((left, right) => left - right);
  line.medianXHeight = Math.max(8, median(line.strokeHeights));
  line.startX = line.bbox.minX;
  line.baseline = line.bbox.maxY;
  drawDebug();
  return { lineId, lineRemoved: false };
}

export function getLastAssignment() {
  return lastAssignment ? { ...lastAssignment } : null;
}

export function getLines() {
  return lines
    .filter((line) => line.bbox)
    .sort((left, right) => left.baseline - right.baseline || left.startX - right.startX)
    .map((line) => ({
      id: line.id,
      strokeIds: line.strokeIds.slice(),
      bbox: { ...line.bbox },
      baseline: line.baseline,
      band: getLineBand(line),
      text: line.text,
      isKeyResult: line.isKeyResult
    }));
}

export function setLineText(lineId, text) {
  const line = lines.find((candidate) => candidate.id === lineId);
  if (line) {
    line.text = text;
  }
}

export function setLineKeyResult(lineId, isKeyResult) {
  const line = lines.find((candidate) => candidate.id === lineId);
  if (line) {
    line.isKeyResult = Boolean(isKeyResult);
  }
}

export function startsNewLineFromPoint(point, lineId = null) {
  const line = lineId
    ? lines.find((candidate) => candidate.id === lineId)
    : lines[lines.length - 1];
  if (!line) {
    return false;
  }

  return startsNewLine({ points: [[point.x, point.y, 0.5, performance.now()]] }, null, line);
}

export function installLineDebug(stage = document.querySelector(".ink-stage")) {
  debugStage = stage;
  window.getLines = getLines;
  window.assignStroke = assignStroke;

  if (debugStage && !debugCanvas) {
    debugCanvas = document.createElement("canvas");
    debugCanvas.setAttribute("aria-hidden", "true");
    debugCanvas.style.position = "absolute";
    debugCanvas.style.inset = "0";
    debugCanvas.style.width = "100%";
    debugCanvas.style.height = "100%";
    debugCanvas.style.pointerEvents = "none";
    debugCanvas.style.zIndex = "3";
    debugCanvas.hidden = true;
    debugStage.appendChild(debugCanvas);
    debugContext = debugCanvas.getContext("2d");
    resizeDebugCanvas();
    window.addEventListener("resize", resizeDebugCanvas);
  }

  window.addEventListener("keydown", toggleDebug);
}

function normalizeStroke(stroke) {
  if (!stroke) {
    return null;
  }
  if (Array.isArray(stroke.points)) {
    return stroke;
  }
  if (Array.isArray(stroke)) {
    return {
      id: `external-${Date.now()}`,
      points: stroke
    };
  }
  return null;
}

function createLine() {
  const line = {
    id: `line-${nextLineId}`,
    strokeIds: [],
    bbox: null,
    baseline: 0,
    startX: 0,
    medianXHeight: DEFAULT_X_HEIGHT,
    strokeHeights: [],
    text: "",
    isKeyResult: false
  };
  nextLineId += 1;
  lines.push(line);
  return line;
}

function attachStrokeToLine(line, stroke, bbox) {
  if (!line.bbox) {
    line.bbox = { ...bbox };
    line.startX = bbox.minX;
  } else {
    line.bbox = mergeBbox(line.bbox, bbox);
    line.startX = Math.min(line.startX, bbox.minX);
  }

  line.strokeIds.push(stroke.id);
  strokeLineIds.set(stroke.id, line.id);
  line.strokeHeights.push(Math.max(1, bbox.height));
  line.strokeHeights.sort((left, right) => left - right);
  line.medianXHeight = Math.max(8, median(line.strokeHeights));
  line.baseline = line.bbox.maxY;
}

function startsNewLine(stroke, bbox, line) {
  const firstPoint = stroke.points[0];
  const penDownX = firstPoint[0];
  const penDownY = firstPoint[1];
  const lineHeight = getLineHeight(line);
  const belowBaseline = penDownY >= line.baseline + lineHeight * LINE_GAP_RATIO;
  const returnLeftBoundary = line.startX + lineHeight * RETURN_LEFT_RATIO;
  const returnedLeft = penDownX <= returnLeftBoundary;
  return belowBaseline && returnedLeft;
}

function findSmallStrokeAttachment(bbox) {
  for (const line of lines) {
    if (!line.bbox) {
      continue;
    }
    const lineHeight = getLineHeight(line);
    const isSmallStroke = bbox.height <= lineHeight * SMALL_STROKE_HEIGHT_RATIO;
    if (isSmallStroke && verticalOverlap(bbox, getLineBand(line)) > 0) {
      return line;
    }
  }
  return null;
}

function findBestOverlappingLine(bbox) {
  let bestLine = null;
  let bestOverlap = 0;

  for (const line of lines) {
    if (!line.bbox) {
      continue;
    }
    const overlap = verticalOverlap(bbox, getLineBand(line));
    const requiredOverlap = line.medianXHeight * SAME_LINE_OVERLAP_RATIO;
    if (overlap >= requiredOverlap && overlap > bestOverlap) {
      bestLine = line;
      bestOverlap = overlap;
    }
  }

  return bestLine;
}

function getLineBand(line) {
  const xHeight = line.medianXHeight || DEFAULT_X_HEIGHT;
  return {
    minY: line.bbox.minY - xHeight * 0.25,
    maxY: line.bbox.maxY + xHeight * 0.25
  };
}

function getLineHeight(line) {
  return Math.max(DEFAULT_X_HEIGHT, line.medianXHeight || 0, line.bbox?.height || 0);
}

function getStrokeBbox(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of points) {
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

function mergeBbox(left, right) {
  const minX = Math.min(left.minX, right.minX);
  const minY = Math.min(left.minY, right.minY);
  const maxX = Math.max(left.maxX, right.maxX);
  const maxY = Math.max(left.maxY, right.maxY);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function verticalOverlap(bbox, band) {
  return Math.max(0, Math.min(bbox.maxY, band.maxY) - Math.max(bbox.minY, band.minY));
}

function median(values) {
  if (values.length === 0) {
    return DEFAULT_X_HEIGHT;
  }
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) {
    return values[middle];
  }
  return (values[middle - 1] + values[middle]) / 2;
}

function toggleDebug(event) {
  if (event.key !== "d" && event.key !== "D") {
    return;
  }
  debugEnabled = !debugEnabled;
  if (debugCanvas) {
    debugCanvas.hidden = !debugEnabled;
  }
  drawDebug();
}

function resizeDebugCanvas() {
  if (!debugCanvas || !debugContext) {
    return;
  }
  const rect = debugCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  debugCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  debugCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  debugContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawDebug();
}

function drawDebug() {
  if (!debugEnabled || !debugCanvas || !debugContext) {
    return;
  }

  const rect = debugCanvas.getBoundingClientRect();
  debugContext.clearRect(0, 0, rect.width, rect.height);
  debugContext.lineWidth = 1.5;
  debugContext.font = "12px ui-sans-serif, system-ui, sans-serif";
  debugContext.textBaseline = "bottom";

  for (const line of getLines()) {
    debugContext.strokeStyle = "rgba(33, 115, 166, 0.9)";
    debugContext.fillStyle = "rgba(33, 115, 166, 0.12)";
    debugContext.strokeRect(line.bbox.minX, line.bbox.minY, line.bbox.width, line.bbox.height);
    debugContext.fillRect(line.bbox.minX, line.bbox.minY, line.bbox.width, line.bbox.height);
    debugContext.strokeStyle = "rgba(166, 58, 33, 0.85)";
    debugContext.beginPath();
    debugContext.moveTo(line.bbox.minX, line.baseline);
    debugContext.lineTo(line.bbox.maxX, line.baseline);
    debugContext.stroke();
    debugContext.fillStyle = "rgba(33, 74, 97, 0.95)";
    debugContext.fillText(line.id, line.bbox.minX, line.bbox.minY - 3);
  }
}
