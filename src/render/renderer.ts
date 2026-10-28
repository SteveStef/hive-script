import beeSheetUrl from '../assets/bumble-bee.png';
import waspSheetUrl from '../assets/wasp.png';
import type { ColonyView } from '../sim/view';
import { COLS, keyTile, MOVE_TICKS, ROWS, SCENT_MAX, SENSE_RANGE, tileKey, type Bee, type Dir, type Season, type Tile } from '../sim/world';
import { edgedSheet, INK, mirrored, recolor, remap } from './pixels';
import { boxesFor, BUDS, FLOWER_SPOTS, makeBoxHive, makeGround, makeNest, TILE, TINY } from './scenery';

// Elthen's "Bumble Bee Sprites" sheet: 4 rows (east, west, north, south) of 4 frames, 32x32 each.
// The bee sits near (16, 14) in each frame and bobs on its own.
const SHEET_ROW: Record<Dir, number> = { east: 0, west: 1, north: 2, south: 3 };
const FRAME = 32;
// The wasp sheet faces east, in 5 rows of 4 frames: hover, fly, sting, hit and death.
// Flying west uses a mirrored copy; flying north or south keeps the side it last faced.
const WASP_ROW = { hover: 0, fly: 1, sting: 2, hit: 3, death: 4 };
const HIT_FRAMES = 18; // how long a stung unit shows its hit frames
// scent colors; each scent name always gets the same one
const SCENT_COLORS = ['180, 140, 255', '255, 107, 139', '95, 211, 224', '255, 216, 74', '255, 154, 61', '155, 227, 107'];

const HUNGRY = 25; // energy below which a bee shows a warning
const RIVAL = '#F04A3A'; // the edge around another player's bees and wasps
const MAX_CELLS = 12; // brood comb cells shown in front of the hive

// A 3x5 pixel font for the numbers that rise over the meadow.
const GLYPHS: Record<string, string[]> = {
  '+': ['...', '.#.', '###', '.#.', '...'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
};

// A color for each custom role, in the order they were made; foragers keep the plain sprite.
// Hues sit well apart, and none is green (lost on the grass) or yellow-orange (a forager's own colors).
const ROLE_COLORS = ['#4FC3F7', '#FF5A6E', '#9B7BFF', '#2EC4B6', '#E6E6F0'];
// The sprite's shaded body yellows. A role's bees get these in the role's color, so their
// underside and stripe edges show the role while the top half stays bumblebee yellow.
const SHADED_BODY = ['#c6851e', '#ce6717'];

/** The marker color for a role, or null for foragers and wasps (which have a sprite of their own). */
export function roleColor(roleNames: string[], role: string): string | null {
  if (role === 'wasp') return null;
  const i = roleNames.indexOf(role);
  return i > 0 ? ROLE_COLORS[(i - 1) % ROLE_COLORS.length] : null;
}

/**
 * Whether a unit is inside its own colony's hive: home, and not on its way out. Units inside
 * aren't drawn, so a winter's worth of resting bees doesn't pile up on one tile; the hive shows
 * how many are in. Raiders on someone else's hive stay in sight.
 */
export function insideHive(world: ColonyView, bee: Unit & { owner?: string | null }, mine: boolean): boolean {
  if (bee.action?.kind === 'move' && bee.action.moving) return false;
  if (mine) return world.atHive(bee);
  return bee.owner != null && world.otherHives.some(h => h.owner === bee.owner && h.x === bee.x && h.y === bee.y);
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

/** A ring of light spreading from where a bee hatched. */
interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
}

/** A short text that rises and fades, such as "+1" over a hatched cell. */
interface Float {
  x: number;
  y: number;
  text: string;
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

/** A bee as the renderer needs it: its body, whoever's it is. */
type Unit = Omit<Bee, 'runner'>;

export interface Placed {
  bee: Unit;
  mine: boolean; // this colony's bee, or another player's
  wild: boolean; // a wild wasp, which belongs to no one
  x: number;
  y: number; // ground position, in canvas pixels
  z: number; // height above the ground
}

export class Renderer {
  readonly width = COLS * TILE;
  readonly height = ROWS * TILE;
  private readonly g: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement | null = null;
  private groundKey = ''; // the map, hives and flowers the ground was drawn for
  private readonly hives = [1, 2, 3, 4].map(makeBoxHive); // by box count: one more box per 50 honey
  private readonly boxes = new Map<number, number>(); // each hive (tileKey) -> the boxes it was last drawn with
  private readonly nest = makeNest();
  private readonly colonyNest = makeNest(true);
  private readonly sheet = new Image();
  private readonly waspSheet = new Image();
  // other players' units edged in red, and wild wasps in the grey of their nests, made once the sheets load;
  // each wasp sheet comes as [facing east, mirrored to face west]
  private units: { rivalBee: HTMLCanvasElement; wasp: Record<'own' | 'rival' | 'wild', [CanvasImageSource, HTMLCanvasElement]> } | null = null;
  private readonly waspFacing = new Map<number, 'east' | 'west'>(); // the side each wasp last faced
  private readonly hits = new Map<number, number>(); // unit id (0: a nest) -> the frame its hit flash ends
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private floats: Float[] = [];
  private ghosts: Ghost[] = []; // a ghost's role "wasp" draws the wasp's death frames
  private readonly weather = Array.from({ length: 48 }, () => ({ x: Math.random() * COLS * TILE, y: Math.random() * ROWS * TILE, phase: Math.random() * 6 }));
  private frame = 0;
  private roleNames: string[] = ['forager'];
  private readonly roleSheets = new Map<string, HTMLCanvasElement>(); // the sprite sheet recolored, by role color

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = this.width;
    canvas.height = this.height;
    this.g = canvas.getContext('2d')!;
    this.sheet.src = beeSheetUrl;
    this.waspSheet.src = waspSheetUrl;
  }

  /** Draws the eye to a tile: rings of light spreading from it, one after another. */
  flash(tile: Tile): void {
    const x = tile.x * TILE + 8;
    const y = tile.y * TILE + 4;
    for (const max of [24, 34, 44]) this.rings.push({ x, y, life: max, max });
  }

  /** Where a bee is right now, including how far along its current move it is (frac: 0..1 of a tick). */
  place(world: ColonyView, bee: Unit & { owner?: string | null }, frac: number, mine = true): Placed {
    let x = bee.x * TILE + 8;
    let y = bee.y * TILE + 8;
    let z = 6;
    const a = bee.action;
    if (a?.kind === 'move') {
      const next = a.path[0];
      // stepLeft counts down from MOVE_TICKS on the tick the tile is claimed, so a 6-tick hop draws as 0/6..6/6
      const hop = a.hop ?? MOVE_TICKS; // a chasing wild wasp flies faster
      const t = a.moving ? Math.min(1, (hop - a.stepLeft + frac) / hop) : 0; // 0 while waiting for the tile
      x += (next.x - bee.x) * TILE * t;
      y += (next.y - bee.y) * TILE * t;
      z = 9;
    } else if (a?.kind === 'collect') {
      z = 4;
    } else if (world.atHive(bee) || world.otherHives.some(h => h.x === bee.x && h.y === bee.y) || world.nests.some(n => n.x === bee.x && n.y === bee.y)) {
      z = 3;
    }
    return { bee, x, y, z, mine, wild: !mine && bee.owner === null };
  }

  /** ghost: while placing a hive, a see-through hive where it would go, its footprint red when it can't. */
  draw(world: ColonyView, frac: number, selectedId: number | null, hover: Tile | null, ghost: { tile: Tile; ok: boolean } | null = null): void {
    const g = this.g;
    const t = world.tick + frac;
    const o = world.origin;
    this.frame++;
    this.roleNames = world.roleNames;
    if (this.frame % 600 === 0) for (const [id, until] of this.hits) if (until < this.frame) this.hits.delete(id);
    for (const e of world.events) {
      if (e.type === 'collect') this.burst(e.x * TILE + 8, e.y * TILE + 4);
      if (e.type === 'death') this.ghosts.push({ role: e.role, x: e.x * TILE + 8, y: e.y * TILE + 2, facing: e.facing, life: 90 });
      if (e.type === 'lay' || e.type === 'hatch' || e.type === 'build') this.burst(e.x * TILE + 8, e.y * TILE + 6, '#FFFFFF');
      if (e.type === 'hatch') {
        // bees hatch from the brood comb in front of the hive; wasps at the nest
        const fromComb = world.hive?.x === e.x && world.hive.y === e.y;
        const x = e.x * TILE + 8;
        const y = fromComb ? e.y * TILE + 22 : e.y * TILE + 8;
        this.rings.push({ x, y, life: 24, max: 24 });
        this.floats.push({ x, y: y - 6, text: '+1', life: 45 });
      }
      if (e.type === 'hit') {
        this.hits.set(e.id, this.frame + HIT_FRAMES);
        this.burst(e.x * TILE + 8, e.y * TILE + 2, e.id === 0 ? '#B8B2A4' : '#F04A3A');
      }
      if (e.type === 'steal') this.burst(e.x * TILE + 8, e.y * TILE + 4, '#FFC93A');
      if (e.type === 'nest') for (let i = 0; i < 4; i++) this.burst(e.x * TILE + 8, e.y * TILE + 4, '#8E887C');
    }

    // every hive on this map: this colony's and any other's (only one per map in practice)
    const hives = [...(world.hive ? [{ ...world.hive, shielded: world.shielded, honey: world.honey }] : []), ...world.otherHives].filter(h => h.x >= o.x && h.y >= o.y && h.x < o.x + COLS && h.y < o.y + ROWS);
    // the leafy ground under the flowers moves with them, so it is redrawn when a new season blooms or the map changes
    const groundKey = `${o.x},${o.y}|${hives.map(h => `${h.x},${h.y}`).join(';')}|${world.flowers.map(f => `${f.x},${f.y}`).join(';')}|${world.hedges.join(';')}`;
    if (groundKey !== this.groundKey) {
      const local = (tile: Tile) => ({ x: tile.x - o.x, y: tile.y - o.y });
      this.ground = makeGround(world.flowers.map(local), hives.map(local), world.hedges.map(k => local(keyTile(k))));
      this.groundKey = groundKey;
    }
    g.drawImage(this.ground!, 0, 0);

    // from here, drawing is in world positions: the map on screen starts at the origin
    g.save();
    g.translate(-o.x * TILE, -o.y * TILE);
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

    if (world.hive && world.eggs.length && hives.some(h => h.x === world.hive!.x && h.y === world.hive!.y)) this.drawBrood(world, world.hive);

    // Depth: a hive's boxes rise over the tiles behind (north of) it. Everything is drawn back to
    // front, so the hive hides bees behind it and bees at or in front of it cover it.
    const stands = hives.map(h => {
      const n = boxesFor(h.honey);
      const key = tileKey(h.x, h.y);
      const was = this.boxes.get(key);
      if (was !== undefined && was !== n) for (let i = 0; i < 3; i++) this.burst(h.x * TILE + 8, h.y * TILE + 15 - this.hives[n - 1].height + 4, n > was ? undefined : '#B8B2A4');
      this.boxes.set(key, n);
      const img = this.hives[n - 1];
      const own = !!world.hive && world.hive.x === h.x && world.hive.y === h.y;
      const home = own
        ? world.bees.filter(b => insideHive(world, b, true)).length
        : world.visitors.filter(b => b.x === h.x && b.y === h.y && insideHive(world, b, false)).length;
      return { img, x: h.x * TILE + 8 - (img.width >> 1), y: h.y * TILE + 15 - img.height, w: img.width, h: img.height, line: h.y * TILE + 8, shielded: h.shielded, home };
    });
    const placed = [
      ...world.bees.filter(b => !insideHive(world, b, true)).map(b => this.place(world, b, frac)),
      ...world.visitors.filter(b => !insideHive(world, b, false)).map(b => this.place(world, b, frac, false)),
    ];
    const sheetReady = this.sheet.complete && this.sheet.naturalWidth > 0;
    const layers = [
      ...placed.map(p => ({ y: p.y, draw: () => {
        // shadows in front of a hive fall on the ground below it, never on its boxes
        const under = stands.find(k => p.y >= k.line && Math.abs(p.x - (k.x + k.w / 2)) < k.w / 2 && p.y < k.y + k.h + 8);
        this.drawShadow(p, under ? under.y + under.h + 1 : null);
        this.drawBee(p, sheetReady, true);
      } })),
      ...stands.map(k => ({ y: k.line - 0.5, draw: () => {
        g.drawImage(k.img, k.x, k.y);
        if (k.shielded) this.drawShield(k.x + k.w / 2, k.y + k.h / 2 + 2, t);
        if (k.home) this.drawText(String(k.home), Math.round(k.x + k.w / 2), k.y - 7); // how many are inside
      } })),
      ...world.nests.map(n => ({ y: n.y * TILE + 7.5, draw: () => {
        const sprite = n.wild ? this.nest : this.colonyNest;
        const x = n.x * TILE + 8 - (sprite.width >> 1);
        const y = n.y * TILE + 15 - sprite.height;
        g.drawImage(sprite, x, y);
        if (n.health < n.maxHealth) this.drawHealth(n.x * TILE + 8, y - 3, n.health, n.maxHealth);
      } })),
    ].sort((a, b) => a.y - b.y);
    for (const layer of layers) layer.draw();
    // a bee hidden behind a dome still shows faintly, so you can keep following it
    g.globalAlpha = 0.4;
    for (const k of stands) {
      for (const p of placed) {
        const top = p.y - p.z - 14;
        if (p.y < k.line && p.x + 8 > k.x && p.x - 8 < k.x + k.w && top < k.y + k.h && top + 22 > k.y) this.drawBee(p, sheetReady, false);
      }
    }
    g.globalAlpha = 1;
    if (ghost) {
      const { tile, ok } = ghost;
      g.fillStyle = ok ? 'rgba(255, 201, 58, 0.25)' : 'rgba(240, 74, 58, 0.35)';
      g.fillRect((tile.x - 1) * TILE, (tile.y - 3) * TILE, 3 * TILE, 5 * TILE);
      g.globalAlpha = ok ? 0.75 : 0.35;
      const hive = this.hives[0];
      g.drawImage(hive, tile.x * TILE + 8 - (hive.width >> 1), tile.y * TILE + 15 - hive.height);
      g.globalAlpha = 1;
    }

    // fallen bees float up and fade
    this.ghosts = this.ghosts.filter(gh => --gh.life > 0);
    for (const gh of this.ghosts) {
      gh.y -= 0.2;
      g.globalAlpha = (gh.life / 90) * 0.7;
      if (gh.role === 'wasp') {
        const fr = Math.min(3, Math.floor((90 - gh.life) / 8));
        this.drawWaspFrame(gh.facing === 'west' ? 'west' : 'east', WASP_ROW.death, fr, Math.round(gh.x), Math.round(gh.y));
      } else if (sheetReady) g.drawImage(this.sheetFor(gh.role), 0, SHEET_ROW[gh.facing] * FRAME, FRAME, FRAME, Math.round(gh.x) - 16, Math.round(gh.y) - 14, FRAME, FRAME);
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
    this.rings = this.rings.filter(r => --r.life > 0);
    for (const r of this.rings) {
      const radius = 3 + (r.max - r.life) * 0.9;
      g.fillStyle = `rgba(255, 240, 180, ${(r.life / r.max).toFixed(2)})`;
      for (let k = 0; k < 48; k++) {
        const a = (k / 48) * Math.PI * 2;
        g.fillRect(Math.round(r.x + Math.cos(a) * radius), Math.round(r.y + Math.sin(a) * radius * 0.7), 1, 1);
      }
    }
    this.floats = this.floats.filter(f => --f.life > 0);
    for (const f of this.floats) {
      g.globalAlpha = Math.min(1, f.life / 15);
      this.drawText(f.text, Math.round(f.x), Math.round(f.y - (45 - f.life) * 0.35));
    }
    g.globalAlpha = 1;
    g.restore();

    this.drawSeason(world.season);

    const sel = placed.find(p => p.mine && p.bee.id === selectedId);
    if (sel) {
      g.save();
      g.translate(-o.x * TILE, -o.y * TILE);
      this.drawPath(sel);
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
      g.restore();
    }
  }

  /**
   * Scent marks: a tinted tile with an outline, fading with the scent. A tile with several
   * scents nests their outlines, strongest outermost.
   */
  private drawScents(world: ColonyView): void {
    const g = this.g;
    for (const key of world.scents.keys()) {
      const { x, y } = keyTile(key);
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

  /** One frame of the wasp sheet, facing east or (mirrored) west, centered like a bee: a player's own, a rival's (edged in red) or a wild one (grey). */
  private drawWaspFrame(side: 'east' | 'west', row: number, fr: number, x: number, y: number, kind: 'own' | 'rival' | 'wild' = 'own'): void {
    const sheets = this.unitSheets();
    if (!sheets) return;
    const [east, west] = sheets.wasp[kind];
    const col = side === 'west' ? 3 - fr : fr;
    this.g.drawImage(side === 'west' ? west : east, col * FRAME, row * FRAME, FRAME, FRAME, x - 16, y - 16, FRAME, FRAME);
  }

  /** The sheets for other players' units and wild wasps, made once both sprite sheets have loaded. */
  private unitSheets(): NonNullable<Renderer['units']> | null {
    if (this.units) return this.units;
    if (!this.sheet.complete || !this.sheet.naturalWidth || !this.waspSheet.complete || !this.waspSheet.naturalWidth) return null;
    const rival = edgedSheet(this.waspSheet, FRAME, RIVAL);
    const wild = remap(this.waspSheet, paperWasp);
    this.units = {
      rivalBee: edgedSheet(this.sheet, FRAME, RIVAL),
      wasp: { own: [this.waspSheet, mirrored(this.waspSheet)], rival: [rival, mirrored(rival)], wild: [wild, mirrored(wild)] },
    };
    return this.units;
  }

  /**
   * The brood comb on the ground in front of the hive: one cell per egg, soonest to hatch first,
   * up to MAX_CELLS in two rows. A cell shows an egg, then a grub, then a cap as it gets close to hatching.
   */
  private drawBrood(world: ColonyView, hive: Tile): void {
    const g = this.g;
    const eggs = [...world.eggs].sort((a, b) => a.hatchAt - b.hatchAt).slice(0, MAX_CELLS);
    const rows = [eggs.slice(0, 6), eggs.slice(6)].filter(r => r.length);
    const w = rows[0].length * 6 + 1 + (rows.length > 1 ? 3 : 0);
    const x0 = hive.x * TILE + 8 - (w >> 1);
    const y0 = hive.y * TILE + 18;
    g.fillStyle = INK;
    g.fillRect(x0 - 1, y0 - 1, w + 2, rows.length * 5 + 3);
    g.fillStyle = '#C9861A';
    g.fillRect(x0, y0, w, rows.length * 5 + 1);
    rows.forEach((row, r) => {
      row.forEach((egg, i) => {
        const x = x0 + 1 + i * 6 + r * 3;
        const y = y0 + 1 + r * 5;
        const p = (world.tick - egg.laidAt) / Math.max(1, egg.hatchAt - egg.laidAt);
        const wasp = egg.role === 'wasp';
        g.fillStyle = '#7A4A1A';
        g.fillRect(x, y, 5, 4);
        if (p < 0.7) {
          g.fillStyle = '#F6E7BB';
          g.fillRect(x + 1, y + 1, 3, 2);
          g.fillStyle = '#FFFFFF';
          if (p < 0.35) g.fillRect(x + 2, y + 1, 1, 2); // an egg standing in the cell
          else g.fillRect(x + 1, y + 2, 3, 1); // a grub curled at the bottom
        } else {
          g.fillStyle = wasp ? '#3B3326' : '#E9B44C'; // capped
          g.fillRect(x + 1, y + 1, 3, 2);
          g.fillStyle = wasp ? '#FFE15A' : '#FFE07A';
          g.fillRect(x + 1, y + 1, wasp ? 3 : 1, 1);
        }
      });
    });
  }

  /** Text in the 3x5 pixel font, centered on x, white with a dark edge. */
  private drawText(text: string, x: number, y: number): void {
    const g = this.g;
    const left = x - Math.floor((text.length * 4 - 1) / 2);
    for (const [color, d] of [[INK, 1], ['#FFFFFF', 0]] as const) {
      g.fillStyle = color;
      [...text].forEach((ch, i) =>
        GLYPHS[ch]?.forEach((line, gy) => {
          for (let gx = 0; gx < 3; gx++) if (line[gx] === '#') g.fillRect(left + i * 4 + gx + d, y + gy + d, 1, 1);
        }),
      );
    }
  }

  /** A protected new colony's hive: a faint golden ring that slowly shimmers around the hive. */
  private drawShield(cx: number, cy: number, t: number): void {
    const g = this.g;
    for (let k = 0; k < 150; k++) {
      const a = (k / 150) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(a) * 29);
      const y = Math.round(cy + Math.sin(a) * 30);
      const glow = 0.5 + 0.5 * Math.max(0, Math.sin(a * 3 - t * 0.05)); // a shimmer runs around the ring
      g.fillStyle = `rgba(120, 80, 10, ${(0.25 * glow).toFixed(2)})`; // a soft dark edge, so it reads on bright grass
      g.fillRect(x, y + 1, 1, 1);
      g.fillStyle = `rgba(255, 236, 150, ${(0.45 + 0.5 * glow).toFixed(2)})`;
      g.fillRect(x, y, 1, 1);
    }
  }

  /** A small bar over a hurt unit or nest: green to red as health runs out. */
  private drawHealth(cx: number, top: number, health: number, max: number): void {
    const g = this.g;
    const w = 10;
    const fill = Math.max(1, Math.round((health / max) * (w - 2)));
    g.fillStyle = INK;
    g.fillRect(cx - (w >> 1), top, w, 3);
    g.fillStyle = health / max > 0.5 ? '#7FD35B' : health / max > 0.25 ? '#F2B632' : '#F04A3A';
    g.fillRect(cx - (w >> 1) + 1, top + 1, fill, 1);
  }

  /** The bee itself; with extras, also the pollen it carries, its health when hurt, and the hungry warning. */
  private drawBee(p: Placed, sheetReady: boolean, extras: boolean): void {
    const g = this.g;
    const x = Math.round(p.x);
    const y = Math.round(p.y - p.z);
    const a = p.bee.action;
    if (p.bee.role === 'wasp') {
      if (p.bee.facing === 'east' || p.bee.facing === 'west') this.waspFacing.set(p.bee.id, p.bee.facing);
      const hit = (this.hits.get(p.bee.id) ?? 0) > this.frame;
      const row = hit ? WASP_ROW.hit : a?.kind === 'sting' ? WASP_ROW.sting : a?.kind === 'move' && a.moving ? WASP_ROW.fly : WASP_ROW.hover;
      const fr = Math.floor((this.frame + p.bee.id * 5) / 6) % 4;
      this.drawWaspFrame(this.waspFacing.get(p.bee.id) ?? 'east', row, fr, x, y, p.mine ? 'own' : p.wild ? 'wild' : 'rival');
    } else if (sheetReady) {
      const fr = Math.floor((this.frame + p.bee.id * 5) / 6) % 4;
      const sheet = p.mine ? this.sheetFor(p.bee.role) : (this.unitSheets()?.rivalBee ?? this.sheet);
      g.drawImage(sheet, fr * FRAME, SHEET_ROW[p.bee.facing] * FRAME, FRAME, FRAME, x - 16, y - 14, FRAME, FRAME);
    } else {
      g.fillStyle = '#F5C127';
      g.fillRect(x - 4, y - 4, 8, 8);
    }
    if (!extras) return;
    if (p.bee.health < p.bee.maxHealth) this.drawHealth(x, y - 17, p.bee.health, p.bee.maxHealth);
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

/** A wasp sprite color in the grey and brown of a wild nest's paper: its yellows go grey, everything else stays. */
function paperWasp(hex: string): string {
  const [h, s, l] = toHsl(hex);
  return s > 0.25 && h > 0.05 && h < 0.2 ? fromHsl(0.09, 0.12, l * 0.92) : hex;
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
