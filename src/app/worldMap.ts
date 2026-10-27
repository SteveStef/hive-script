import { INK, sprite } from '../render/pixels';
import { bloomMap, COLS, HIVE_SPOT, NEST_SPOT, ROWS, seasonAt, yearAt, type FlowerKind, type Tile } from '../sim/world';

/** One map of the world as /api/world describes it. */
export interface MapCell {
  map: Tile;
  nest: boolean; // a wild wasp nest hangs here: no one can found a colony until it's destroyed
  owner: string | null;
  mine: boolean;
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
// a tiny skep for a held map: s = straw, d = dark band, o = the door
const SKEP = ['..sss..', '.ddddd.', 'sssssss', 'ddddddd', 'sssosss'];
// a tiny wild nest: p = paper, d = dark band, o = the door
const NEST = ['.ppp.', 'ppppp', 'ddddd', 'ppppp', '.pop.'];

const cache = new Map<string, HTMLCanvasElement>();

/** A map in miniature: this season's flowers on it, and a skep if someone holds it. */
export function thumbnail(seed: number, map: Tile, tick: number, held: boolean, nest: boolean): HTMLCanvasElement {
  const season = seasonAt(tick);
  const key = `${seed}:${map.x},${map.y}:${yearAt(tick)}:${season}:${held}:${nest}`;
  let c = cache.get(key);
  if (c) return c;
  c = sprite(COLS * PX, ROWS * PX, g => {
    g.fillStyle = GRASS[season];
    g.fillRect(0, 0, COLS * PX, ROWS * PX);
    // a faint check of tiles, so the thumbnail reads as a map
    g.fillStyle = 'rgba(20, 60, 10, 0.08)';
    for (let y = 0; y < ROWS; y++) for (let x = (y % 2); x < COLS; x += 2) g.fillRect(x * PX, y * PX, PX, PX);
    for (const f of bloomMap(seed, map, yearAt(tick), season)) {
      const [lit, dark] = BLOOM[f.kind];
      const x = (f.x - map.x * COLS) * PX;
      const y = (f.y - map.y * ROWS) * PX;
      g.fillStyle = dark;
      g.fillRect(x + 1, y + 1, 2, 2);
      g.fillStyle = lit;
      g.fillRect(x + 1, y + 1, 1, 1);
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
    if (held) {
      const ox = HIVE_SPOT.x * PX + PX / 2 - 7;
      const oy = HIVE_SPOT.y * PX + PX - 10;
      SKEP.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          g.fillStyle = ch === 's' ? '#E9B44C' : ch === 'd' ? '#9C6A24' : INK;
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
  const cells = world.maps.map(cell => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `world-cell${cell.owner || cell.nest ? '' : ' free'}${cell.nest ? ' nest' : ''}${cell.mine ? ' mine' : ''}${watching && watching.x === cell.map.x && watching.y === cell.map.y ? ' watching' : ''}`;
    const where = `[${cell.map.x}, ${cell.map.y}]`;
    const label = document.createElement('span');
    const bees = `${cell.bees} bee${cell.bees === 1 ? '' : 's'}`;
    label.textContent = cell.mine ? `You · ${bees}` : cell.owner ? `${cell.owner} · ${bees}` : cell.nest ? `Wild nest ${where}` : `Free ${where}`;
    b.title = cell.owner
      ? `Map ${where}: ${cell.mine ? 'your colony' : `${cell.owner}'s colony`}, ${cell.bees} bees, ${cell.honey} honey stored, ${cell.made} made in all`
      : cell.nest ? `Map ${where}: a wild wasp nest. Its wasps sting any bee that comes near; destroy it with wasps to free the map.` : `Map ${where}: a free meadow`;
    b.append(thumbnail(world.seed, cell.map, world.tick, !!cell.owner, cell.nest), label);
    b.addEventListener('click', () => onPick(cell));
    return b;
  });
  grid.replaceChildren(...cells);
}
