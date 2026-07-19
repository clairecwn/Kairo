import { getStroke } from "https://esm.sh/perfect-freehand@1.2.2";

export const PEN_COLORS = [
  { id: "auto", label: "Ink", light: "#2A2A26", dark: "#ECE9E2" },
  { id: "clay", label: "Clay", value: "#C15F3C" },
  { id: "blue", label: "Blue", value: "#3B6EA5" },
  { id: "green", label: "Green", value: "#4F7B58" },
  { id: "purple", label: "Purple", value: "#7C5CBF" },
  { id: "red", label: "Red", value: "#B4453E" }
];

export const PEN_SIZES = [
  { id: "fine", label: "Fine", value: 3.4 },
  { id: "medium", label: "Medium", value: 5.8 },
  { id: "bold", label: "Bold", value: 9 }
];

export function resolveStrokeColor(color) {
  const entry = PEN_COLORS.find((candidate) => candidate.id === color);
  if (!entry) {
    return color || "#2A2A26";
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
