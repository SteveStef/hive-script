import beeSheetUrl from '../assets/bumble-bee.png';
import { INK, disc, outlined, paint, sprite } from '../render/pixels';
import { FLOWER_SPOTS, makeSkep, TINY } from '../render/scenery';
import { mulberry32 } from '../sim/rng';
import type { Dir, FlowerKind } from '../sim/world';

// The same sheet as the game: 4 rows (east, west, north, south) of 4 frames, 32x32 each.
const SHEET_ROW: Record<Dir, number> = { east: 0, west: 1, north: 2, south: 3 };
const FRAME = 32;
const KINDS: FlowerKind[] = ['clover', 'lavender', 'goldenrod'];

interface Bloom {
  x: number;
  y: number;
  kind: FlowerKind;
  shade: number;
}

interface TitleBee {
  x: number;
  y: number;
  tx: number;
  ty: number;
  speed: number;
  rest: number; // frames left hovering at the target
  facing: Dir;
  phase: number;
}

/**
 * The backdrop of the sign-in and menu pages: a meadow that fills the window, a skep,
 * and a few bees going between the flowers and home. Clicking the meadow sends a bee there.
 */
export class TitleMeadow {
  private readonly g: CanvasRenderingContext2D;
  private readonly sheet = new Image();
  private readonly skep = makeSkep();
  private readonly still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private scale = 3;
  private ground: HTMLCanvasElement | null = null;
  private blooms: Bloom[] = [];
  private bees: TitleBee[] = [];
  private home = { x: 0, y: 0 }; // the skep's entrance
  private skepAt = { x: 0, y: 0 };
  private raf = 0;
  private last = 0;
  private t = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d')!;
    this.sheet.src = beeSheetUrl;
    this.sheet.onload = () => this.draw();
    addEventListener('resize', () => this.raf && this.layout());
    canvas.addEventListener('pointerdown', e => this.send(e.clientX / this.scale, e.clientY / this.scale));
  }

  start(): void {
    if (this.raf) return;
    this.layout();
    this.last = performance.now();
    const loop = (now: number) => {
      this.step(Math.min(3, (now - this.last) / (1000 / 60)));
      this.last = now;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = this.still ? -1 : requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf > 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Sizes the meadow to the window in big pixels, and plants it again. */
  private layout(): void {
    this.scale = Math.max(2, Math.min(5, Math.round(Math.min(innerWidth / 440, innerHeight / 250))));
    const W = Math.ceil(innerWidth / this.scale);
    const H = Math.ceil(innerHeight / this.scale);
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = `${W * this.scale}px`;
    this.canvas.style.height = `${H * this.scale}px`;
    const rnd = mulberry32(7);

    // the page's panels sit in the middle, so on a wide window the flowers grow either side
    const clear = innerWidth > 900 ? 300 / this.scale : 0;
    const open = (x: number) => Math.abs(x - W / 2) > clear;
    // the skep sits low on the left, under the panels' corner
    this.skepAt = { x: Math.round(W * 0.1), y: Math.max(10, H - 62) };
    this.home = { x: this.skepAt.x + 22, y: this.skepAt.y + 40 };

    this.blooms = [];
    const patches = Math.max(6, Math.round((W * H) / 5000));
    for (let p = 0, tries = 0; p < patches && tries < 400; tries++) {
      const cx = 12 + rnd() * (W - 24);
      const cy = 16 + rnd() * (H - 28);
      if (!open(cx) || Math.hypot(cx - this.home.x, cy - this.home.y) < 40) continue;
      p++;
      const kind = KINDS[Math.floor(rnd() * KINDS.length)];
      for (let i = 0, n = 3 + Math.floor(rnd() * 4); i < n; i++) {
        const tx = Math.round(cx + (rnd() - 0.5) * 34);
        const ty = Math.round(cy + (rnd() - 0.5) * 24);
        for (const [dx, dy] of FLOWER_SPOTS) this.blooms.push({ x: tx + dx - 8, y: ty + dy - 8, kind, shade: Math.floor(rnd() * 2) });
      }
    }
    this.blooms.sort((a, b) => a.y - b.y);
    this.ground = this.makeGround(W, H, rnd);

    const count = Math.max(4, Math.min(14, Math.round((W * H) / 9000)));
    this.bees = Array.from({ length: count }, () => {
      const b: TitleBee = { x: rnd() * W, y: rnd() * H, tx: 0, ty: 0, speed: 0.35 + rnd() * 0.3, rest: 0, facing: 'east', phase: Math.floor(rnd() * 24) };
      this.pickTarget(b);
      return b;
    });
    this.draw();
  }

  private makeGround(W: number, H: number, rnd: () => number): HTMLCanvasElement {
    return sprite(W, H, g => {
      g.fillStyle = '#6EAB36';
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < (W * H) / 3000; i++) disc(g, rnd() * W, rnd() * H, 14 + rnd() * 22, 7 + rnd() * 9, '#76B33C', true);
      for (let i = 0; i < this.blooms.length; i += 6) disc(g, this.blooms[i].x + 6, this.blooms[i].y + 8, 10, 8, '#5F9C2F', true);
      disc(g, this.home.x, this.home.y + 2, 18, 6, '#A7834F', true);
      const tufts = [['d...d', 'd.d.d', '.ddd.'], ['d.d', 'ddd'], ['..d..', 'd.d.d', 'ddddd']];
      for (let i = 0; i < (W * H) / 900; i++) {
        const x = Math.floor(rnd() * W);
        const y = Math.floor(rnd() * H);
        paint(g, tufts[Math.floor(rnd() * tufts.length)], { d: '#55902A' }, x, y);
        g.fillStyle = '#8CC650';
        g.fillRect(x, y, 1, 1);
      }
      for (let i = 0; i < (W * H) / 600; i++) {
        g.fillStyle = rnd() < 0.5 ? '#7DBA44' : '#5E9A2E';
        g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 1, 1);
      }
    });
  }

  /** Most trips go to a flower; now and then a bee heads home. */
  private pickTarget(b: TitleBee): void {
    if (Math.random() < 0.2 || !this.blooms.length) {
      b.tx = this.home.x + (Math.random() - 0.5) * 6;
      b.ty = this.home.y - 4;
    } else {
      const f = this.blooms[Math.floor(Math.random() * this.blooms.length)];
      b.tx = f.x + 1;
      b.ty = f.y - 2;
    }
  }

  /** Sends the nearest bee to a spot on the meadow. */
  private send(x: number, y: number): void {
    let best: TitleBee | null = null;
    for (const b of this.bees) if (!best || Math.hypot(b.x - x, b.y - y) < Math.hypot(best.x - x, best.y - y)) best = b;
    if (!best) return;
    best.tx = x;
    best.ty = y;
    best.rest = 0;
    if (this.still) {
      best.x = x;
      best.y = y;
      this.draw();
    }
  }

  private step(dt: number): void {
    this.t += dt;
    for (const b of this.bees) {
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        if (b.rest <= 0) b.rest = 60 + Math.random() * 150;
        b.rest -= dt;
        if (b.rest <= 0) this.pickTarget(b);
        continue;
      }
      const v = Math.min(d, b.speed * dt);
      // a lazy weave across the line of flight
      const weave = Math.sin((this.t + b.phase * 10) * 0.06) * 0.35 * dt;
      b.x += (dx / d) * v - (dy / d) * weave;
      b.y += (dy / d) * v + (dx / d) * weave;
      b.facing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'south' : 'north';
    }
  }

  private draw(): void {
    const g = this.g;
    if (!this.ground) return;
    g.drawImage(this.ground, 0, 0);
    const t = this.t;
    for (const f of this.blooms) {
      const w = Math.sin(t * 0.03 - f.x * 0.05 - f.y * 0.02) + 0.45 * Math.sin(t * 0.01 + f.x * 0.03);
      g.drawImage(TINY[f.kind][f.shade], f.x - 1 + (w > 1.05 ? 1 : w < -1.25 ? -1 : 0), f.y - 1);
    }
    g.drawImage(this.skep, this.skepAt.x, this.skepAt.y);

    const ready = this.sheet.complete && this.sheet.naturalWidth > 0;
    for (const b of [...this.bees].sort((a, c) => a.y - c.y)) {
      const hovering = Math.hypot(b.tx - b.x, b.ty - b.y) < 1;
      const bob = hovering ? Math.round(Math.sin((t + b.phase * 8) * 0.12)) : 0;
      g.fillStyle = 'rgba(20, 50, 10, 0.25)';
      g.fillRect(Math.round(b.x) - 3, Math.round(b.y) + 8, 7, 2);
      if (!ready) continue;
      const frame = Math.floor(t / 6 + b.phase) % 4;
      g.drawImage(this.sheet, frame * FRAME, SHEET_ROW[b.facing] * FRAME, FRAME, FRAME, Math.round(b.x) - 16, Math.round(b.y) - 14 + bob, FRAME, FRAME);
    }
  }
}

/** A pixel honeycomb: flat-topped hex cells at (column, row) positions, each a color, outlined in ink. */
export function combArt(cells: { c: number; r: number; color: string }[], radius: number, extra?: (g: CanvasRenderingContext2D, centers: [number, number][]) => void): HTMLCanvasElement {
  const h = Math.round(radius * Math.sqrt(3));
  const step = radius * 1.5 + 1;
  const centers = cells.map(({ c, r }): [number, number] => [Math.round(radius + c * step), Math.round(h / 2 + r * (h + 1) + (c % 2 ? (h + 1) / 2 : 0))]);
  const W = Math.max(...centers.map(([x]) => x)) + radius + 1;
  const H = Math.max(...centers.map(([, y]) => y)) + Math.ceil(h / 2) + 1;
  return outlined(
    sprite(W, H, g => {
      cells.forEach(({ color }, i) => {
        const [cx, cy] = centers[i];
        for (let y = -Math.floor(h / 2); y < Math.ceil(h / 2); y++) {
          const half = Math.floor(radius - Math.abs(y + 0.5) / Math.sqrt(3));
          g.fillStyle = y < -h / 2 + 2 ? shade(color, 1.18) : y >= h / 2 - 2 ? shade(color, 0.8) : color;
          g.fillRect(cx - half, cy + y, half * 2, 1);
        }
      });
      extra?.(g, centers);
    }),
    INK,
  );
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/** The menu's pictures: one cell with a skep for single player, a comb of players' cells for multiplayer, an open book for the tutorial. */
export function menuArt(): { single: string; multi: string; tutorial: string } {
  const skep = makeSkep();
  const single = combArt([{ c: 0, r: 0, color: '#6EAB36' }], 36, (g, [[cx, cy]]) => {
    disc(g, cx, cy + 20, 15, 4, '#A7834F', true);
    g.drawImage(skep, cx - 23, cy - 25);
  });
  const grass = '#6EAB36';
  const mine = '#F5C127';
  const theirs = '#D88E1F';
  const multi = combArt(
    [
      { c: 0, r: 0, color: grass },
      { c: 0, r: 1, color: theirs },
      { c: 1, r: 0, color: mine },
      { c: 1, r: 1, color: grass },
      { c: 2, r: 0, color: theirs },
      { c: 2, r: 1, color: grass },
      { c: 3, r: 0, color: grass },
      { c: 3, r: 1, color: theirs },
    ],
    13,
  );
  // an open book: two pages of script lines, a honey hex on the left page
  const book = outlined(
    sprite(46, 30, g => {
      const R = (x: number, y: number, w: number, h: number, c: string) => {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
      };
      R(0, 4, 46, 26, '#7A4A22'); // cover
      R(2, 2, 20, 25, '#FBF1D4'); // left page
      R(24, 2, 20, 25, '#F1E2B8'); // right page
      R(22, 3, 2, 25, '#C9A86A'); // spine
      for (let i = 0; i < 6; i++) {
        R(27, 6 + i * 3, i % 3 === 2 ? 9 : 14, 1, i % 2 ? '#9BD37E' : '#C98A1A'); // code lines
      }
      for (let y = 0; y < 9; y++) {
        const half = 5 - Math.floor(Math.abs(y - 4) / 2);
        R(11 - half, 8 + y, half * 2, 1, y < 2 ? '#FFE27A' : y > 6 ? '#C98A1A' : '#F5C127');
      }
      R(5, 21, 13, 1, '#C9A86A');
      R(5, 23, 9, 1, '#C9A86A');
    }),
    INK,
  );
  return { single: single.toDataURL(), multi: multi.toDataURL(), tutorial: book.toDataURL() };
}
