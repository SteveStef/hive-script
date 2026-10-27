import { mulberry32 } from '../sim/rng';
import { COLS, ROWS, type FlowerKind, type Tile } from '../sim/world';
import { disc, INK, outlined, paint, sprite } from './pixels';

export const TILE = 16;

/** One map's grass, tufts, leafy ground under flowers, worn dirt at its hive and a faint tile grid; positions are within the map. */
export function makeGround(flowers: Tile[], hives: Tile[]): HTMLCanvasElement {
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
  });
}

/** Straw skep: stacked coils of straw (groove, body, highlight), binding stitches, lit from the left. */
export function makeSkep(): HTMLCanvasElement {
  const W = 21;
  const H = 46;
  const C = 22;
  const B = 46;
  const half = (h: number) => W * Math.pow(Math.max(0, 1 - Math.pow(h / H, 2.4)), 1 / 2.4) - (h < 2 ? 1 : 0);
  return outlined(
    sprite(45, 47, g => {
      const R = (x: number, y: number, w: number, h: number, c: string) => {
        g.fillStyle = c;
        g.fillRect(x, y, w, h);
      };
      for (let h = 0; h <= H; h++) {
        const hw = half(h);
        if (hw < 1) continue;
        const y = B - h;
        const x0 = Math.round(C - hw);
        const x1 = Math.round(C + hw);
        const band = h % 5;
        for (let x = x0; x <= x1; x++) {
          const u = (x - C) / hw;
          let col = band === 0 ? '#8A5A1E' : band === 4 ? '#F2CB72' : '#D9A441';
          if (u > 0.45) col = band === 0 ? '#6E4616' : band === 4 ? '#D9A441' : '#B8822E';
          else if (u < -0.55 && band !== 0) col = '#F2CB72';
          R(x, y, 1, 1, col);
        }
        if (band === 2) for (let x = x0 + 3 + ((Math.floor(h / 5)) % 2) * 3; x < x1 - 2; x += 6) R(x, y - 1, 1, 3, '#9C6A24');
      }
      // arched entrance, then a honey drip down the side
      for (let h = 1; h <= 7; h++) {
        const w = h <= 4 ? 5 : h === 5 ? 4 : h === 6 ? 3 : 1;
        R(C - w, B - h, w * 2, 1, h === 7 ? '#2E1C10' : '#1A0F08');
      }
      R(C + 9, B - 24, 2, 1, '#FFD45A');
      R(C + 9, B - 23, 1, 5, '#E99A12');
      R(C + 10, B - 23, 1, 2, '#C2700C');
      R(C + 9, B - 18, 2, 2, '#E99A12');
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
