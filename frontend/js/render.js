import { getStroke } from "https://esm.sh/perfect-freehand@1.2.2";

export const PEN_COLORS = [
  { id: "auto", label: "Ink", light: "#35322B", dark: "#EAE6DA" },
  { id: "brown", label: "Brown", value: "#8A6D4F" },
  { id: "blue", label: "Blue", value: "#5B7B9E" },
  { id: "green", label: "Green", value: "#6F8F66" },
  { id: "purple", label: "Purple", value: "#8B7BB0" },
  { id: "red", label: "Red", value: "#B06A5E" }
];

export const PEN_SIZES = [
  { id: "fine", label: "Fine", value: 3.4 },
  { id: "medium", label: "Medium", value: 5.8 },
  { id: "bold", label: "Bold", value: 9 }
];

export function resolveStrokeColor(color) {
  if (color === "clay") {
    // Legacy strokes from the old palette.
    return "#8A6D4F";
  }
  const entry = PEN_COLORS.find((candidate) => candidate.id === color);
  if (!entry) {
    return typeof color === "string" && color.startsWith("#") ? color : "#35322B";
  }
  if (entry.id === "auto") {
    return isDarkTheme() ? entry.dark : entry.light;
  }
  return entry.value;
}

export function isDarkTheme() {
  return document.documentElement.dataset.theme === "dark";
}

function strokeOptions(size, penType) {
  if (penType === "highlighter") {
    return {
      size: size * 2.4,
      thinning: 0,
      smoothing: 0.6,
      streamline: 0.4,
      easing: (t) => t,
      simulatePressure: false,
      start: { taper: 0, cap: true },
      end: { taper: 0, cap: true }
    };
  }
  return {
    size,
    thinning: 0.64,
    smoothing: 0.58,
    streamline: 0.42,
    easing: (t) => t,
    simulatePressure: false,
    start: { taper: 0, cap: true },
    end: { taper: penType === "marker" ? 0 : 12, cap: true }
  };
}

export function drawStrokePoints(context, stroke, dx = 0, dy = 0, colorOverride = null) {
  const points = stroke.points;
  if (!points || points.length === 0) {
    return;
  }
  const size = stroke.size || 5.8;
  const color = colorOverride || resolveStrokeColor(stroke.color);
  const alpha = stroke.penType === "highlighter" ? 0.38 : 1;

  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;

  if (points.length < 2) {
    const [x, y] = points[0];
    context.beginPath();
    context.arc(x + dx, y + dy, Math.max(1.6, size / 2), 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  const outline = getStroke(
    points.map(([x, y, pressure]) => [x + dx, y + dy, pressure]),
    strokeOptions(size, stroke.penType)
  );
  if (outline.length === 0) {
    context.restore();
    return;
  }
  context.beginPath();
  context.moveTo(outline[0][0], outline[0][1]);
  for (let index = 1; index < outline.length; index += 1) {
    context.lineTo(outline[index][0], outline[index][1]);
  }
  context.closePath();
  context.fill();
  context.restore();
}
