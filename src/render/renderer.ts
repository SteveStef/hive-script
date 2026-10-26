import beeSheetUrl from '../assets/bumble-bee.png';
import { COLS, MOVE_TICKS, ROWS, SCENT_MAX, SENSE_RANGE, type Bee, type Dir, type Flower, type Season, type Tile, type World } from '../sim/world';
import { INK, recolor } from './pixels';
import { BUDS, FLOWER_SPOTS, makeGround, makeSkep, TILE, TINY } from './scenery';

// Elthen's "Bumble Bee Sprites" sheet: 4 rows (east, west, north, south) of 4 frames, 32x32 each.
// The bee sits near (16, 14) in each frame and bobs on its own.
const SHEET_ROW: Record<Dir, number> = { east: 0, west: 1, north: 2, south: 3 };
const FRAME = 32;
// scent colors; each scent name always gets the same one
const SCENT_COLORS = ['180, 140, 255', '255, 107, 139', '95, 211, 224', '255, 216, 74', '255, 154, 61', '155, 227, 107'];

const HUNGRY = 25; // energy below which a bee shows a warning

// A color for each custom role, in the order they were made; foragers keep the plain sprite.
// Hues sit well apart, and none is green (lost on the grass) or yellow-orange (a forager's own colors).
const ROLE_COLORS = ['#4FC3F7', '#FF5A6E', '#9B7BFF', '#2EC4B6', '#E6E6F0'];
// The sprite's shaded body yellows. A role's bees get these in the role's color, so their
// underside and stripe edges show the role while the top half stays bumblebee yellow.
const SHADED_BODY = ['#c6851e', '#ce6717'];

/** The marker color for a role, or null for foragers. */
export function roleColor(roleNames: string[], role: string): string | null {
  const i = roleNames.indexOf(role);
  return i > 0 ? ROLE_COLORS[(i - 1) % ROLE_COLORS.length] : null;
}

// A wash of color over the meadow for each season.
const SEASON_TINT: Record<Season, string | null> = {
  spring: null,
  summer: 'rgba(255, 214, 120, 0.07)',
  autumn: 'rgba(214, 120, 40, 0.16)',
  winter: 'rgba(225, 238, 255, 0.4)',
};

interface Ghost {
  role: string;
  x: number;
  y: number;
  facing: Dir;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface Placed {
  bee: Bee;
  x: number;
  y: number; // ground position, in canvas pixels
  z: number; // height above the ground
}

export class Renderer {
  readonly width = COLS * TILE;
  readonly height = ROWS * TILE;
  private readonly g: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement | null = null;
  private groundFlowers: Flower[] | null = null; // the flowers the ground was drawn for
  private readonly skep = makeSkep();
  private readonly sheet = new Image();
  private particles: Particle[] = [];
  private ghosts: Ghost[] = [];
  private readonly weather = Array.from({ length: 48 }, () => ({ x: Math.random() * COLS * TILE, y: Math.random() * ROWS * TILE, phase: Math.random() * 6 }));
  private frame = 0;
  private roleNames: string[] = ['forager'];
  private readonly roleSheets = new Map<string, HTMLCanvasElement>(); // the sprite sheet recolored, by role color

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = this.width;
    canvas.height = this.height;
    this.g = canvas.getContext('2d')!;
    this.sheet.src = beeSheetUrl;
  }

  /** Where a bee is right now, including how far along its current move it is (frac: 0..1 of a tick). */
  place(world: World, bee: Bee, frac: number): Placed {
    let x = bee.x * TILE + 8;
    let y = bee.y * TILE + 8;
    let z = 6;
    const a = bee.action;
    if (a?.kind === 'move') {
      const next = a.path[0];
      // stepLeft counts down from MOVE_TICKS on the tick the tile is claimed, so a 6-tick hop draws as 0/6..6/6
      const t = a.moving ? Math.min(1, (MOVE_TICKS - a.stepLeft + frac) / MOVE_TICKS) : 0; // 0 while waiting for the tile
      x += (next.x - bee.x) * TILE * t;
      y += (next.y - bee.y) * TILE * t;
      z = 9;
    } else if (a?.kind === 'collect') {
      z = 4;
    } else if (world.atHive(bee)) {
      z = 3;
    }
    return { bee, x, y, z };
  }

  draw(world: World, frac: number, selectedId: number | null, hover: Tile | null): void {
    const g = this.g;
    const t = world.tick + frac;
    this.frame++;
    this.roleNames = world.roleNames;
    for (const e of world.events) {
      if (e.type === 'collect') this.burst(e.x * TILE + 8, e.y * TILE + 4);
      if (e.type === 'death') this.ghosts.push({ role: world.findBee(e.id)?.role ?? 'forager', x: e.x * TILE + 8, y: e.y * TILE + 2, facing: e.facing, life: 90 });
      if (e.type === 'lay' || e.type === 'hatch' || e.type === 'build') this.burst(world.hive.x * TILE + 8, world.hive.y * TILE + 6, '#FFFFFF');
    }

    // the leafy ground under the flowers moves with them, so it is redrawn when a new season blooms
    if (world.flowers !== this.groundFlowers) {
      this.ground = makeGround(world.flowers, world.hive);
      this.groundFlowers = world.flowers;
    }
    g.drawImage(this.ground!, 0, 0);
    this.drawScents(world);
    if (hover) {
      g.fillStyle = 'rgba(255, 255, 255, 0.2)';
      g.fillRect(hover.x * TILE, hover.y * TILE, TILE, TILE);
    }

    // a breeze rolls left to right; flowers lean one pixel as it passes
    const wind = (x: number, y: number) => {
      const w = Math.sin(t * 0.045 - x * 0.05 - y * 0.02) + 0.45 * Math.sin(t * 0.013 + x * 0.03);
      return w > 1.05 ? 1 : w < -1.25 ? -1 : 0;
    };
    for (const f of world.flowers) {
      const open = Math.ceil((f.nectar / f.max) * FLOWER_SPOTS.length);
      FLOWER_SPOTS.forEach(([dx, dy], i) => {
        const px = f.x * TILE + dx;
        const py = f.y * TILE + dy;
        const shade = (f.color + i) % 2;
        if (i < open) g.drawImage(TINY[f.kind][shade], px - 1 + wind(px, py), py - 1);
        else g.drawImage(BUDS[f.kind][shade], px - 1 + wind(px, py), py);
      });
    }

    // Depth: the skep's dome rises over the tiles behind (north of) the hive. Bees back there are
    // drawn first so the dome hides them; bees at or in front of the hive are drawn after it.
    const skep = {
      x: world.hive.x * TILE + 8 - (this.skep.width >> 1),
      y: world.hive.y * TILE + 15 - this.skep.height,
      w: this.skep.width,
      h: this.skep.height,
    };
    const hiveLine = world.hive.y * TILE + 8;
    const placed = world.bees.map(b => this.place(world, b, frac)).sort((a, b) => a.y - b.y);
    const behind = placed.filter(p => p.y < hiveLine);
    const front = placed.filter(p => p.y >= hiveLine);
    const sheetReady = this.sheet.complete && this.sheet.naturalWidth > 0;

    for (const p of behind) this.drawShadow(p, null);
    for (const p of behind) this.drawBee(p, sheetReady, true);
    g.drawImage(this.skep, skep.x, skep.y);
    // a bee hidden behind the dome still shows faintly, so you can keep following it
    g.globalAlpha = 0.4;
    for (const p of behind) {
      const top = p.y - p.z - 14;
      if (p.x + 8 > skep.x && p.x - 8 < skep.x + skep.w && top < skep.y + skep.h && top + 22 > skep.y) this.drawBee(p, sheetReady, false);
    }
    g.globalAlpha = 1;
    // shadows in front of the hive fall on the ground below the skep, never on the straw
    for (const p of front) this.drawShadow(p, Math.abs(p.x - (skep.x + skep.w / 2)) < skep.w / 2 ? skep.y + skep.h + 1 : null);
    for (const p of front) this.drawBee(p, sheetReady, true);

    // fallen bees float up and fade
    this.ghosts = this.ghosts.filter(gh => --gh.life > 0);
    for (const gh of this.ghosts) {
      gh.y -= 0.2;
      g.globalAlpha = (gh.life / 90) * 0.7;
      if (sheetReady) g.drawImage(this.sheetFor(gh.role), 0, SHEET_ROW[gh.facing] * FRAME, FRAME, FRAME, Math.round(gh.x) - 16, Math.round(gh.y) - 14, FRAME, FRAME);
      g.globalAlpha = 1;
    }

    this.particles = this.particles.filter(p => --p.life > 0);
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.03;
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }

    this.drawSeason(world.season);

    const sel = placed.find(p => p.bee.id === selectedId);
    if (sel) this.drawPath(sel);
    if (sel) {
      // what the bee can see, then a pointer above it
      g.fillStyle = 'rgba(255, 255, 255, 0.55)';
      const cx = sel.bee.x * TILE + 8;
      const cy = sel.bee.y * TILE + 8;
      const r = SENSE_RANGE * TILE;
      for (let k = 0; k < 120; k += 2) {
        const a = (k / 120) * Math.PI * 2;
        g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
      }
      const x = Math.round(sel.x);
      const y = Math.round(sel.y - sel.z) - 15;
      g.fillStyle = INK;
      g.fillRect(x - 2, y - 1, 5, 3);
      g.fillRect(x - 1, y + 2, 3, 1);
      g.fillStyle = '#FFFFFF';
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y + 1, 1, 1);
    }
  }

  /**
   * Scent marks: a tinted tile with an outline, fading with the scent. A tile with several
   * scents nests their outlines, strongest outermost.
   */
  private drawScents(world: World): void {
    const g = this.g;
    for (const key of world.scents.keys()) {
      const x = key % COLS;
      const y = Math.floor(key / COLS);
      world.scentsAt(x, y).slice(0, 3).forEach(([name, strength], i) => {
        const rgb = SCENT_COLORS[scentHash(name) % SCENT_COLORS.length];
        const a = strength / SCENT_MAX;
        const inset = 1 + i * 2;
        const px = x * TILE + inset;
        const py = y * TILE + inset;
        const size = TILE - inset * 2;
        if (i === 0) {
          g.fillStyle = `rgba(${rgb}, ${0.05 + 0.12 * a})`;
          g.fillRect(px, py, size, size);
        }
        g.fillStyle = `rgba(${rgb}, ${0.12 + 0.45 * a})`;
        g.fillRect(px, py, size, 1);
        g.fillRect(px, py + size - 1, size, 1);
        g.fillRect(px, py + 1, 1, size - 2);
        g.fillRect(px + size - 1, py + 1, 1, size - 2);
      });
    }
  }

  /**
   * The followed bee's plan: a dotted line through every tile it still means to fly through
   * (including any detour around other bees), and brackets on its destination.
   */
  private drawPath(p: Placed): void {
    const a = p.bee.action;
    if (a?.kind !== 'move') return;
    const g = this.g;
    const center = (t: Tile) => ({ x: t.x * TILE + 8, y: t.y * TILE + 8 });
    const points = [{ x: p.x, y: p.y }, ...a.path.map(center)];
    const dot = (x: number, y: number) => {
      g.fillStyle = INK;
      g.fillRect(x - 1, y - 1, 3, 3);
      g.fillStyle = '#FFE27A';
      g.fillRect(x, y, 1, 1);
    };
    let travelled = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      // a dot every 5px along the whole line, skipping the stretch right under the bee
      for (let d = (5 - (travelled % 5)) % 5; d < len; d += 5) {
        if (travelled + d < 8) continue;
        dot(Math.round(from.x + ((to.x - from.x) * d) / len), Math.round(from.y + ((to.y - from.y) * d) / len));
      }
      travelled += len;
    }
    // corner brackets around the destination tile
    const x0 = a.target.x * TILE;
    const y0 = a.target.y * TILE;
    const corners: [number, number, number, number][] = [[0, 0, 1, 1], [TILE - 1, 0, -1, 1], [0, TILE - 1, 1, -1], [TILE - 1, TILE - 1, -1, -1]];
    for (const [cx, cy, sx, sy] of corners) {
      for (const [w, h, color, inset] of [[5, 2, INK, 0], [4, 1, '#FFE27A', 0]] as const) {
        g.fillStyle = color;
        const px = x0 + cx + inset;
        const py = y0 + cy + inset;
        g.fillRect(sx > 0 ? px : px - w + 1, sy > 0 ? py : py - h + 1, w, h); // along x
        g.fillRect(sx > 0 ? px : px - h + 1, sy > 0 ? py : py - w + 1, h, w); // along y
      }
    }
  }

  /** A flat oval on the ground under the bee, smaller the higher it flies; never above minY. */
  private drawShadow(p: Placed, minY: number | null): void {
    const g = this.g;
    const w = Math.max(6, 12 - Math.floor(p.z / 3));
    const x = Math.round(p.x);
    const y = Math.max(Math.round(p.y) + 5, minY ?? -Infinity);
    g.fillStyle = '#4C8530';
    g.fillRect(x - (w >> 1) + 2, y - 1, w - 4, 1);
    g.fillRect(x - (w >> 1), y, w, 2);
    g.fillRect(x - (w >> 1) + 2, y + 2, w - 4, 1);
  }

  /** The bee itself; with extras, also the pollen it carries and the hungry warning. */
  private drawBee(p: Placed, sheetReady: boolean, extras: boolean): void {
    const g = this.g;
    const x = Math.round(p.x);
    const y = Math.round(p.y - p.z);
    if (sheetReady) {
      const fr = Math.floor((this.frame + p.bee.id * 5) / 6) % 4;
      g.drawImage(this.sheetFor(p.bee.role), fr * FRAME, SHEET_ROW[p.bee.facing] * FRAME, FRAME, FRAME, x - 16, y - 14, FRAME, FRAME);
    } else {
      g.fillStyle = '#F5C127';
      g.fillRect(x - 4, y - 4, 8, 8);
    }
    if (!extras) return;
    if (p.bee.carrying > 0) {
      // pollen on the legs
      g.fillStyle = '#F28C28';
      g.fillRect(x - 4, y + 6, 2, 1);
      g.fillRect(x + 3, y + 6, 2, 1);
    }
    if (p.bee.energy < HUNGRY && (this.frame >> 4) % 2) {
      // blinking "!" over a hungry bee
      g.fillStyle = INK;
      g.fillRect(x - 1, y - 14, 3, 7);
      g.fillStyle = '#F04A3A';
      g.fillRect(x, y - 13, 1, 3);
      g.fillRect(x, y - 9, 1, 1);
    }
  }

  /** The sprite sheet for a role's bees: the plain one for foragers, otherwise recolored once and kept. */
  private sheetFor(role: string): CanvasImageSource {
    const color = roleColor(this.roleNames, role);
    if (!color) return this.sheet;
    let sheet = this.roleSheets.get(color);
    if (!sheet) {
      sheet = recolor(this.sheet, Object.fromEntries(SHADED_BODY.map(c => [c, tint(c, color)])));
      this.roleSheets.set(color, sheet);
    }
    return sheet;
  }

  private drawSeason(season: Season): void {
    const g = this.g;
    const tint = SEASON_TINT[season];
    if (tint) {
      g.fillStyle = tint;
      g.fillRect(0, 0, this.width, this.height);
    }
    if (season !== 'autumn' && season !== 'winter') return;
    // falling leaves in autumn, snow in winter
    for (const w of this.weather) {
      w.phase += 0.03;
      w.y += season === 'winter' ? 0.35 : 0.25;
      w.x += Math.sin(w.phase) * 0.3 - (season === 'autumn' ? 0.15 : 0);
      if (w.y > this.height) w.y = -2;
      if (w.x < -2) w.x = this.width;
      if (w.x > this.width + 2) w.x = 0;
      if (season === 'winter') {
        g.fillStyle = '#FFFFFF';
        g.fillRect(Math.round(w.x), Math.round(w.y), 1, 1);
      } else {
        g.fillStyle = w.phase % 2 < 1 ? '#D9822B' : '#B8562A';
        g.fillRect(Math.round(w.x), Math.round(w.y), 2, 1);
      }
    }
  }

  private burst(x: number, y: number, only?: string): void {
    for (let i = 0; i < 7; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -Math.random() * 0.8,
        life: 14 + Math.floor(Math.random() * 10),
        color: only ?? (i % 2 ? '#FFE27A' : '#F5C127'),
      });
    }
  }
}

function scentHash(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * A sprite color moved to a role's hue. It keeps its own lightness, so the sprite's shading
 * survives; a near-grey role color (silver) gives a near-grey result instead of a vivid one.
 */
function tint(source: string, role: string): string {
  const [, s, l] = toHsl(source);
  const [h, rs] = toHsl(role);
  return fromHsl(h, rs < 0.25 ? rs : Math.max(s, rs * 0.85), l);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, '0')).join('');
}
