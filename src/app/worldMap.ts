import { INK, sprite } from '../render/pixels';
import { bloomMap, COLS, hedgeLayout, HIVE_SPOT, keyTile, NEST_SPOT, ROWS, seasonAt, tileKey, yearAt, type FlowerKind, type Tile } from '../sim/world';

/** One map of the world as /api/world describes it. */
export interface MapCell {
  map: Tile;
  nest: boolean; // a wild wasp nest hangs here: no one can found a colony until it's destroyed
  owner: string | null;
  mine: boolean;
  shieldEnds: number | null; // a protected new colony, until then (real time, ms)
  hive: Tile | null; // where the colony's hive sits, in world tiles
  bees: number;
  honey: number;
  made: number; // honey made over the colony's life
}

/** The player's world: its size, clock, and who holds each map. */
export interface WorldOverview {
  world: number;
  seed: number;
  tick: number;
  size: [number, number];
  hedges: boolean; // hedgerows along the borders, with a gate in each
  tickMs: number;
  home: Tile | null; // the player's colony's map
  fallen: string | null; // how their last colony ended, until they found another
  maps: MapCell[];
}

const PX = 4; // thumbnail pixels per tile
const GRASS: Record<string, string> = { spring: '#6EAB36', summer: '#76B33C', autumn: '#8FA43A', winter: '#B9C9B4' };
const BLOOM: Record<FlowerKind, [string, string]> = {
  clover: ['#FFFFFF', '#F6B4D2'],
  lavender: ['#BCA4F4', '#7B5CC6'],
  goldenrod: ['#FFE15A', '#D9A520'],
};
// a tiny box hive for a held map: t = tin roof, m = a box on top, c = the bottom box, o = the door, b = blocks
const HIVE = ['ttttttt', '.mmmmm.', '.ccccc.', '.coooc.', '.b...b.'];
const HIVE_COLORS: Record<string, string> = { t: '#AEB7BC', m: '#9CC9C2', c: '#ECE0BC', o: INK, b: '#9A968C' };
// a tiny wild nest: p = paper, d = dark band, o = the door
const NEST = ['.ppp.', 'ppppp', 'ddddd', 'ppppp', '.pop.'];

const cache = new Map<string, HTMLCanvasElement>();

/** A map in miniature: this season's flowers on it, and a box hive where its hive is, if someone holds it. */
export function thumbnail(seed: number, map: Tile, tick: number, hive: Tile | null, nest: boolean, hedges: Set<number> | null = null): HTMLCanvasElement {
  const season = seasonAt(tick);
  const key = `${seed}:${map.x},${map.y}:${yearAt(tick)}:${season}:${hive ? `${hive.x},${hive.y}` : '-'}:${nest}:${!!hedges}`;
  let c = cache.get(key);
  if (c) return c;
  c = sprite(COLS * PX, ROWS * PX, g => {
    g.fillStyle = GRASS[season];
    g.fillRect(0, 0, COLS * PX, ROWS * PX);
    // a faint check of tiles, so the thumbnail reads as a map
    g.fillStyle = 'rgba(20, 60, 10, 0.08)';
    for (let y = 0; y < ROWS; y++) for (let x = (y % 2); x < COLS; x += 2) g.fillRect(x * PX, y * PX, PX, PX);
    for (const f of bloomMap(seed, map, yearAt(tick), season, hive ? [hive] : [])) {
      if (hedges?.has(tileKey(f.x, f.y))) continue;
      const [lit, dark] = BLOOM[f.kind];
      const x = (f.x - map.x * COLS) * PX;
      const y = (f.y - map.y * ROWS) * PX;
      g.fillStyle = dark;
      g.fillRect(x + 1, y + 1, 2, 2);
      g.fillStyle = lit;
      g.fillRect(x + 1, y + 1, 1, 1);
    }
    if (hedges) {
      // the map's whole fence: its own hedge tiles, and the neighbors' side of the right and
      // bottom borders as a strip, so every gate shows as a gap
      for (const k of hedges) {
        const t = keyTile(k);
        const x = t.x - map.x * COLS;
        const y = t.y - map.y * ROWS;
        let r: [number, number, number, number] | null = null;
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS) r = [x * PX, y * PX, PX, PX];
        else if (x === COLS && y >= 0 && y < ROWS) r = [COLS * PX - 2, y * PX, 2, PX];
        else if (y === ROWS && x >= 0 && x < COLS) r = [x * PX, ROWS * PX - 2, PX, 2];
        if (!r) continue;
        g.fillStyle = '#1E3D12';
        g.fillRect(...r);
        g.fillStyle = '#4F8A2C';
        g.fillRect(r[0], r[1], r[2] > 2 ? r[2] - 1 : 1, 1);
      }
    }
    if (nest) {
      // a grey paper ball where the nest hangs
      const ox = NEST_SPOT.x * PX + PX / 2 - 5;
      const oy = NEST_SPOT.y * PX + PX - 12;
      NEST.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          g.fillStyle = ch === 'p' ? '#B8B2A4' : ch === 'd' ? '#7A756B' : INK;
          g.fillRect(ox + x * 2, oy + y * 2, 2, 2);
        }),
      );
    }
    if (hive) {
      const ox = (hive.x - map.x * COLS) * PX + PX / 2 - 7;
      const oy = (hive.y - map.y * ROWS) * PX + PX - 10;
      HIVE.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          g.fillStyle = HIVE_COLORS[ch];
          g.fillRect(ox + x * 2, oy + y * 2, 2, 2);
        }),
      );
    }
  });
  cache.set(key, c);
  return c;
}

/** Fills the world map's grid: one button per map, labeled with who holds it. */
export function renderWorldGrid(grid: HTMLElement, world: WorldOverview, watching: Tile | null, onPick: (cell: MapCell) => void): void {
  grid.style.gridTemplateColumns = `repeat(${world.size[0]}, minmax(0, 1fr))`;
  const hedges = world.hedges ? hedgeLayout(world.seed, world.size).hedges : null;
  const cells = world.maps.map(cell => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `world-cell${cell.owner || cell.nest ? '' : ' free'}${cell.nest ? ' nest' : ''}${cell.mine ? ' mine' : ''}${watching && watching.x === cell.map.x && watching.y === cell.map.y ? ' watching' : ''}`;
    const where = `[${cell.map.x}, ${cell.map.y}]`;
    const label = document.createElement('span');
    const bees = `${cell.bees} bee${cell.bees === 1 ? '' : 's'}`;
    const shield = cell.shieldEnds ? ' · new' : '';
    label.textContent = cell.mine ? `You · ${bees}${shield}` : cell.owner ? `${cell.owner} · ${bees}${shield}` : cell.nest ? `Wild nest ${where}` : `Free ${where}`;
    b.title = cell.owner
      ? `Map ${where}: ${cell.mine ? 'your colony' : `${cell.owner}'s colony`}, ${cell.bees} bees, ${cell.honey} honey stored, ${cell.made} made in all${cell.shieldEnds ? '. A protected new colony: it can\'t be raided or stung yet' : ''}`
      : cell.nest ? `Map ${where}: a wild wasp nest. Its wasps sting any bee that comes near; destroy it with wasps to free the map.` : `Map ${where}: a free meadow`;
    b.append(thumbnail(world.seed, cell.map, world.tick, cell.owner ? (cell.hive ?? { x: cell.map.x * COLS + HIVE_SPOT.x, y: cell.map.y * ROWS + HIVE_SPOT.y }) : null, cell.nest, hedges), label);
    b.addEventListener('click', () => onPick(cell));
    return b;
  });
  grid.replaceChildren(...cells);
}
