export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * Empty room for a picture of `size`, as close to `anchor` as it fits without
 * touching any of `taken`: its four sides first, the way a person would put a
 * sketch beside the page it explains, then rings further out, and past the
 * whole drawing's right edge when nothing nearer is free.
 */
export function placeBeside(
  anchor: Rect,
  size: { width: number; height: number },
  taken: readonly Rect[],
  gap = 48,
): Rect {
  const { width, height } = size;
  const free = (x: number, y: number): Rect | null => {
    const spot = { x, y, width, height };
    return taken.some((one) => overlaps(spot, one, gap)) ? null : spot;
  };
  const middleY = anchor.y + Math.max(0, (Math.min(anchor.height, height * 2) - height) / 2);
  const middleX = anchor.x + (anchor.width - width) / 2;
  const sides: [number, number][] = [
    [anchor.x + anchor.width + gap, middleY],
    [anchor.x - gap - width, middleY],
    [middleX, anchor.y + anchor.height + gap],
    [middleX, anchor.y - gap - height],
  ];
  for (const [x, y] of sides) {
    const spot = free(x, y);
    if (spot) return spot;
  }
  const stepX = width / 2 + gap;
  const stepY = height / 2 + gap;
  for (let ring = 1; ring <= 8; ring++) {
    const tries: [number, number][] = [];
    for (let i = -ring; i <= ring; i++) {
      tries.push([sides[0]![0] + ring * stepX, middleY + i * stepY]);
      tries.push([sides[1]![0] - ring * stepX, middleY + i * stepY]);
      tries.push([middleX + i * stepX, sides[2]![1] + ring * stepY]);
      tries.push([middleX + i * stepX, sides[3]![1] - ring * stepY]);
    }
    tries.sort(
      (a, b) =>
        Math.hypot(a[0] - anchor.x, a[1] - anchor.y) - Math.hypot(b[0] - anchor.x, b[1] - anchor.y),
    );
    for (const [x, y] of tries) {
      const spot = free(x, y);
      if (spot) return spot;
    }
  }
  const right = taken.reduce((edge, one) => Math.max(edge, one.x + one.width), anchor.x + anchor.width);
  return { x: right + gap, y: anchor.y, width, height };
}
