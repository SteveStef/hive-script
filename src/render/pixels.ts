// Small helpers for drawing pixel art in code.

export const INK = '#1B1210'; // the shared outline color

export function sprite(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

/** Draws a character map; each character is looked up in the palette, unknown ones are skipped. */
export function paint(g: CanvasRenderingContext2D, map: string[], palette: Record<string, string>, ox: number, oy: number): void {
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  });
}

/** Returns a copy of the sprite with a 1px outline around every opaque pixel. */
export function outlined(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const w = src.width + 2;
  const h = src.height + 2;
  return sprite(w, h, g => {
    g.drawImage(src, 1, 1);
    const data = g.getImageData(0, 0, w, h).data;
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
    g.fillStyle = color;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x, y, 1, 1);
      }
    }
  });
}

/** Fills an ellipse; with dither, its outer rim is a checkerboard so it blends into the ground. */
export function disc(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, dither = false): void {
  g.fillStyle = color;
  for (let y = -Math.ceil(ry); y <= ry; y++) {
    for (let x = -Math.ceil(rx); x <= rx; x++) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      const px = Math.round(cx + x);
      const py = Math.round(cy + y);
      if (d > 1 || (dither && d > 0.7 && (px + py) % 2)) continue;
      g.fillRect(px, py, 1, 1);
    }
  }
}
