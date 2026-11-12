export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Free {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function fitWhole(
  area: Box,
  free: Free,
  margin: number,
  limits: { min: number; max: number },
): { x: number; y: number; scale: number } {
  const wide = Math.max(1, free.right - free.left - 2 * margin);
  const tall = Math.max(1, free.bottom - free.top - 2 * margin);
  const fitted = Math.min(wide / Math.max(1, area.width), tall / Math.max(1, area.height));
  const scale = Math.min(limits.max, Math.max(limits.min, fitted));
  const middleX = (free.left + free.right) / 2;
  const middleY = (free.top + free.bottom) / 2;
  return {
    x: middleX - (area.x + area.width / 2) * scale,
    y: middleY - (area.y + area.height / 2) * scale,
    scale,
  };
}
