import { mulberry32 } from '../sim/rng';
import { COLS, ROWS, type FlowerKind, type Tile } from '../sim/world';
import { disc, INK, outlined, paint, sprite } from './pixels';

export const TILE = 16;

/**
 * One map's grass, tufts, leafy ground under flowers, worn dirt at its hive, hedgerows and a faint
 * tile grid; positions are within the map. Hedge tiles just past the right and bottom edges (the
 * neighbors' side of a shared border) are drawn as a strip along that edge, gaps and all.
 */
export function makeGround(flowers: Tile[], hives: Tile[], hedges: Tile[] = []): HTMLCanvasElement {
  const W = COLS * TILE;
  const H = ROWS * TILE;
  return sprite(W, H, g => {
    const rnd = mulberry32(99);
    g.fillStyle = '#6EAB36';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) disc(g, rnd() * W, rnd() * H, 14 + rnd() * 22, 7 + rnd() * 9, '#76B33C', true);
    for (const f of flowers) disc(g, f.x * TILE + 8, f.y * TILE + 9, 10, 8, '#5F9C2F', true);
    for (const hive of hives) disc(g, hive.x * TILE + 8, hive.y * TILE + 15, 13, 5, '#A7834F', true);

    const tufts = [['d...d', 'd.d.d', '.ddd.'], ['d.d', 'ddd'], ['..d..', 'd.d.d', 'ddddd']];
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rnd() * W);
      const y = Math.floor(rnd() * H);
      paint(g, tufts[Math.floor(rnd() * tufts.length)], { d: '#55902A' }, x, y);
      g.fillStyle = '#8CC650';
      g.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 80; i++) {
      g.fillStyle = rnd() < 0.5 ? '#7DBA44' : '#5E9A2E';
      g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 1, 1);
    }

    // a faint grid so players can read positions off the map
    g.fillStyle = 'rgba(20, 60, 10, 0.12)';
    for (let x = 1; x < COLS; x++) g.fillRect(x * TILE, 0, 1, H);
    for (let y = 1; y < ROWS; y++) g.fillRect(0, y * TILE, W, 1);

    for (const h of hedges) {
      if (h.x < COLS && h.y < ROWS) drawHedge(g, h.x * TILE, h.y * TILE, TILE, TILE, h.x * 31 + h.y);
      else if (h.x === COLS && h.y >= 0 && h.y < ROWS) drawHedge(g, W - 4, h.y * TILE, 4, TILE, h.y); // the neighbor's hedge, east
      else if (h.y === ROWS && h.x >= 0 && h.x < COLS) drawHedge(g, h.x * TILE, H - 4, TILE, 4, h.x); // and south
    }
  });
}

/** A block of hedgerow: dark leaves, lighter clumps, a few lit leaf tips, and a shadow at its foot. */
function drawHedge(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  const rnd = mulberry32(seed + 7);
  g.fillStyle = '#2F5E1B';
  g.fillRect(x, y, w, h);
  for (let i = 0; i < (w * h) / 10; i++) {
    g.fillStyle = rnd() < 0.5 ? '#4F8A2C' : '#3F7424';
    g.fillRect(x + Math.floor(rnd() * (w - 1)), y + Math.floor(rnd() * (h - 1)), 2, 2);
  }
  for (let i = 0; i < (w * h) / 40; i++) {
    g.fillStyle = '#6BAA3A';
    g.fillRect(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), 1, 1);
  }
  g.fillStyle = 'rgba(16, 32, 8, 0.45)';
  g.fillRect(x, y + h - 1, w, 1);
}

// the bottom box is cream; boxes stacked on it as honey grows are mint, honey, pink and lavender
const BOXES: [string, string, string][] = [
  ['#ECE0BC', '#CDBF94', '#FFF6DA'],
  ['#9CC9C2', '#77A59E', '#C4E6E0'],
  ['#F2C46A', '#CF9C3C', '#FFE0A0'],
  ['#E8A0A4', '#C47A7E', '#F8C6C8'],
  ['#BCA8E4', '#9682C2', '#DCD0F6'],
];
const BOX_H = 9;

/**
 * The honey at which each box past the first goes on: two or three for a healthy colony, the last
 * ones only for a hive stocked over years. Five boxes is the most that fits in the hive's
 * footprint, the tiles where nothing grows.
 */
export const BOX_HONEY = [100, 200, 500, 800];

/** How many boxes a hive stands with: one, plus one for each BOX_HONEY step it has reached. */
export const boxesFor = (honey: number): number => 1 + BOX_HONEY.filter(h => honey >= h).length;

/**
 * A painted box hive: a tin roof, stacked boxes with hand holds, an entrance slit over a landing
 * board, all on two blocks. Its bottom edge stands on the hive tile's bottom.
 */
export function makeBoxHive(boxes = 1): HTMLCanvasElement {
  const W = 38;
  const H = 14 + boxes * BOX_H;
  return outlined(
    sprite(W, H, g => {
      const R = (x: number, y: number, w: number, h: number, c: string) => {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
      };
      const x0 = 3;
      const bw = 32;
      let y = 0;
      // the roof: a tin lid with ribs and a lip
      R(x0 - 2, y, bw + 4, 1, '#E4E9EB');
      R(x0 - 2, y + 1, bw + 4, 3, '#AEB7BC');
      R(x0 - 2, y + 4, bw + 4, 1, '#7D868B');
      for (let x = x0 + 2; x < x0 + bw; x += 5) R(x, y + 1, 1, 3, '#C9D0D4');
      y += 5;
      for (let i = boxes - 1; i >= 0; i--) {
        const [c, shade, lit] = BOXES[i];
        R(x0, y, bw, BOX_H, c);
        R(x0, y, bw, 1, lit);
        R(x0 + bw - 4, y + 1, 4, BOX_H - 1, shade);
        R(x0, y + BOX_H - 1, bw, 1, shade);
        R(x0 + 11, y + 3, 9, 2, '#5C3A1C'); // the hand hold
        R(x0 + 11, y + 3, 9, 1, '#3A2210');
        y += BOX_H;
      }
      // the entrance slit, then the landing board
      R(x0 + 9, y - 2, 14, 1, '#1A0F08');
      R(x0 - 1, y, bw + 2, 2, '#8B5A2B');
      R(x0 + 6, y + 2, 20, 1, '#C48A50');
      R(x0 + 6, y + 3, 20, 1, '#8B5A2B');
      // two blocks
      for (const bx of [x0 + 1, x0 + bw - 10]) {
        R(bx, y + 4, 9, 5, '#9A968C');
        R(bx, y + 4, 9, 1, '#BDB9AE');
        R(bx + 3, y + 6, 3, 2, '#6E6A60');
      }
    }),
    INK,
  );
}

// Tiny flowers, drawn from small pixel maps: l = lit petal, s = shaded petal, c = accent, g = stem.
// Each kind has its own shape and two shades, so a patch reads as one kind at a glance.
const STEM = '#3F7424';
const FLOWER_ART: Record<FlowerKind, { map: string[]; shades: [string, string, string][] }> = {
  // clover: a round white or pink head
  clover: { map: ['.l.', 'lcs', '.s.', '.g.'], shades: [['#FFFFFF', '#D5CEDB', '#F4C6DA'], ['#F6B4D2', '#D27BA6', '#FFE3EF']] },
  // lavender: a narrow spike of purple buds
  lavender: { map: ['.l', 'ls', '.c', 'ls', '.g'], shades: [['#BCA4F4', '#7B5CC6', '#DCCEFB'], ['#9D82E6', '#634AAE', '#C9B8F5']] },
  // goldenrod: a nodding plume of tiny yellow heads
  goldenrod: { map: ['l.l', '.lc', 'ls.', '.g.'], shades: [['#FFE15A', '#D9A520', '#FFF3A8'], ['#F7C531', '#C98A1A', '#FFE27A']] },
};
const KINDS = Object.keys(FLOWER_ART) as FlowerKind[];

/** Open flowers for each kind, one per shade. */
export const TINY = Object.fromEntries(
  KINDS.map(kind => {
    const { map, shades } = FLOWER_ART[kind];
    return [kind, shades.map(([l, sh, c]) => sprite(map[0].length, map.length, g => paint(g, map, { l, s: sh, c, g: STEM }, 0, 0)))];
  }),
) as Record<FlowerKind, HTMLCanvasElement[]>;

/** A closed bud in the flower's own color, shown once its nectar is taken. */
export const BUDS = Object.fromEntries(
  KINDS.map(kind => [
    kind,
    FLOWER_ART[kind].shades.map(([, shade]) =>
      sprite(2, 2, g => {
        g.fillStyle = shade;
        g.fillRect(0, 0, 2, 1);
        g.fillStyle = STEM;
        g.fillRect(0, 1, 2, 1);
      }),
    ),
  ]),
) as Record<FlowerKind, HTMLCanvasElement[]>;
/** Where the tiny flowers sit inside a flower tile. */
export const FLOWER_SPOTS: [number, number][] = [[3, 3], [10, 2], [7, 7], [12, 10], [3, 11], [8, 13]];

// paper colors for a nest: dark band, light band, mid band, the lit side, the shaded side
const WILD_PAPER = ['#8E887C', '#B8B2A4', '#A39D90', '#CFC9BB', '#706B61'];
// a colony's own nest, in wasp yellow and black, so it never reads as a wild one
const COLONY_PAPER = ['#2B2420', '#F2C230', '#E0A91E', '#FFE27A', '#B7841A'];

/** A wasp nest: a paper ball in bands, with its door at the bottom, lit from the left. Grey when wild. */
export function makeNest(colony = false): HTMLCanvasElement {
  const [dark, light, mid, lit, shade] = colony ? COLONY_PAPER : WILD_PAPER;
  const W = 15;
  const H = 18;
  return outlined(
    sprite(W, H, g => {
      const cx = 7;
      const cy = 8.5;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const u = (x - cx) / 7.2;
          const v = (y - cy) / 8.8;
          if (u * u + v * v > 1) continue;
          const band = Math.floor(y + Math.sin(x * 0.9) * 0.8) % 3;
          let col = band === 0 ? dark : band === 1 ? light : mid;
          if (u < -0.45 && band !== 0) col = lit;
          if (u > 0.5) col = band === 0 ? dark : shade;
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      }
      g.fillStyle = '#1A140F'; // the door
      g.fillRect(cx - 1, H - 4, 3, 2);
      g.fillRect(cx, H - 2, 1, 1);
    }),
    INK,
  );
}
