import { mulberry32 } from '../sim/rng';
import { COLS, ROWS, type Tile } from '../sim/world';
import { disc, INK, outlined, paint, sprite } from './pixels';

export const TILE = 16;

/** Grass, tufts, leafy ground under flowers, worn dirt at the hive and a faint tile grid. */
export function makeGround(flowers: Tile[], hive: Tile): HTMLCanvasElement {
  const W = COLS * TILE;
  const H = ROWS * TILE;
  return sprite(W, H, g => {
    const rnd = mulberry32(99);
    g.fillStyle = '#6EAB36';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9; i++) disc(g, rnd() * W, rnd() * H, 14 + rnd() * 22, 7 + rnd() * 9, '#76B33C', true);
    for (const f of flowers) disc(g, f.x * TILE + 8, f.y * TILE + 9, 10, 8, '#5F9C2F', true);
    disc(g, hive.x * TILE + 8, hive.y * TILE + 15, 13, 5, '#A7834F', true);

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

// Tiny flowers: a 3x3 plus with a lit top petal, a shaded bottom petal and a drop shadow.
const FLOWER_COLORS = [
  ['#FFFFFF', '#C9CDD0', '#F2C230'],
  ['#F7D640', '#D9A520', '#E07A1F'],
  ['#8EC3F2', '#5A8ED0', '#F6F2E2'],
  ['#E85050', '#9A2228', '#F2C230'],
];
export const TINY = FLOWER_COLORS.map(([light, shade, center]) =>
  sprite(3, 4, g => {
    const P = (x: number, y: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(x, y, 1, 1);
    };
    P(1, 0, light);
    P(0, 1, light);
    P(1, 1, center);
    P(2, 1, shade);
    P(1, 2, shade);
    P(2, 2, '#3F7424');
    P(1, 3, '#3F7424');
  }),
);
/** A closed bud in the flower's own color, shown once its nectar is taken. */
export const BUDS = FLOWER_COLORS.map(([, shade]) =>
  sprite(2, 2, g => {
    g.fillStyle = shade;
    g.fillRect(0, 0, 2, 1);
    g.fillStyle = '#3F7424';
    g.fillRect(0, 1, 2, 1);
  }),
);
/** Where the tiny flowers sit inside a flower tile. */
export const FLOWER_SPOTS: [number, number][] = [[3, 3], [10, 2], [7, 7], [12, 10], [3, 11], [8, 13]];
