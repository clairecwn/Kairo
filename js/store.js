let nextStrokeId = 1;
const strokes = [];

export function addStroke(points, style = {}) {
  const id = `stroke-${nextStrokeId}`;
  nextStrokeId += 1;
  strokes.push({
    id,
    points: points.map(([x, y, pressure, t]) => [x, y, pressure, t]),
    lineId: null,
    color: style.color || "auto",
    size: style.size || 5.8,
    penType: style.penType || "pen"
  });
  return id;
}

export function removeStroke(id) {
  const index = strokes.findIndex((stroke) => stroke.id === id);
  if (index === -1) {
    return null;
  }
  return strokes.splice(index, 1)[0];
}

export function restoreStroke(record) {
  if (!record || strokes.some((stroke) => stroke.id === record.id)) {
    return;
  }
  strokes.push(record);
}

export function getStrokes() {
  return strokes.map((stroke) => ({
    id: stroke.id,
    points: stroke.points.map(([x, y, pressure, t]) => [x, y, pressure, t]),
    lineId: stroke.lineId,
    color: stroke.color,
    size: stroke.size,
    penType: stroke.penType
  }));
}
