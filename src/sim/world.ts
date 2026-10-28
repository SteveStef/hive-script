import type { Stmt } from '../lang/ast';
import { Runner, type Value } from '../lang/interpreter';
import { beeGlobals, queenGlobals } from './api';
import { mulberry32, type Rng } from './rng';

// ---- tuning ----

// one map; a single player meadow is one map, and a multiplayer world is a grid of them
export const COLS = 20;
export const ROWS = 12;
/** Where a colony's hive sits inside its map; a single player hive is at [2, 6]. */
export const HIVE_SPOT = { x: 2, y: 6 };

/**
 * The tiles a hive keeps clear: its own, the stacked boxes over the three rows behind (north of)
 * it, and the row in front. No flower grows there.
 */
export function inFootprint(hive: Tile, x: number, y: number): boolean {
  return Math.abs(x - hive.x) <= 1 && y >= hive.y - 3 && y <= hive.y + 1;
}
export const OPS_PER_TICK = 50; // script operations each bee (and the queen) may run per tick
export const SENSE_RANGE = 6; // tiles a bee can see flowers from
export const SMELL_RANGE = 12; // tiles a bee can smell scent from; scent carries farther than sight

// action lengths, in ticks
export const MOVE_TICKS = 6; // per tile
export const COLLECT_TICKS = 10;
export const DEPOSIT_TICKS = 6;
export const EAT_TICKS = 8;
export const BUILD_TICKS = 40;
export const LAY_TICKS = 30;
export const BUMP_TICKS = 3; // flying into the edge of the map or another bee
export const MAX_BLOCKED_TICKS = 18; // ticks one move_to() may spend blocked, in total, before giving up
export const MAX_WAIT = 3000;
export const MARK_TICKS = 1; // leaving scent is quick, so sharing a find costs almost nothing

// scent
export const SCENT_LIFE = 2400; // ticks a mark lasts, most of a season (2:40 at 1x); it fades evenly to nothing
export const SCENT_MAX = 100; // a fresh mark's strength
export const SCENT_NAME_MAX = 20; // characters in a scent's name, like "food" or "danger"

// flowers: each season but winter grows its own kind, in patches placed from the seed
export type FlowerKind = 'clover' | 'lavender' | 'goldenrod';
export interface Bloom {
  kind: FlowerKind;
  patches: number;
  size: [number, number]; // flowers per patch, smallest and largest
  near: number; // how close to the hive a patch may be, in tiles
  far: number; // ...and how far
  nectar: number; // what each flower holds when full
}
export const BLOOMS: Record<Exclude<Season, 'winter'>, Bloom> = {
  // fewer, richer patches than bees can see from home: finding them is part of the game
  spring: { kind: 'clover', patches: 3, size: [3, 4], near: 4, far: 10, nectar: 5 }, // a few patches around home
  summer: { kind: 'lavender', patches: 5, size: [3, 5], near: 4, far: 18, nectar: 5 }, // across the meadow, refilling fast
  autumn: { kind: 'goldenrod', patches: 3, size: [4, 6], near: 9, far: 18, nectar: 8 }, // few, far out, but rich
};

// the colony
export const START_BEES = 1; // in a World built for a test, lesson or docs clip
export const START_HONEY = 10; // a new game's colony: no bees yet, and honey for one egg of any role
/** How a new single player or multiplayer colony starts: the queen lays its first bee. */
export const NEW_COLONY = { bees: 0, honey: START_HONEY };
export const START_COMB = 10; // cells; every bee and every egg needs one
export const COMB_LIMIT = 120;
export const BEE_LIMIT = 120; // a safety ceiling for performance; comb is the real limit
export const BEE_COST = 10; // honey per egg
export const MAX_ROLES = 5; // custom roles, on top of forager
export const ROLE_NAME = /^[a-z][a-z0-9_]{0,11}$/; // lowercase, up to 12 characters
export const RESERVED_NAMES = ['forager', 'wasp', 'queen', 'shared']; // file names a custom role can't take
/** Lines of shared.bee are numbered from here, so they can't be mistaken for a role script's own lines. */
export const SHARED_LINE_BASE = 100_000;
export const HATCH_TICKS = 300;
export const BUILD_COST = 15; // honey turned into wax for one cell of comb
const EMPTY_HIVE_TICKS = 900; // with no bees or eggs for this long, the colony is over

// energy and life
export const MAX_ENERGY = 100;
export const ENERGY_PER_TILE = 1;
export const ENERGY_PER_WORK = 0.5; // each collect, deposit, eat or mark; building costs 4x
export const ENERGY_IDLE = 0.02; // per tick spent thinking, waiting or bumping
export const ENERGY_PER_HONEY = 40;
export const LIFESPAN_MIN = 3600; // ticks; about 4 minutes at 1x
export const LIFESPAN_MAX = 5400;

// health and fights: stings hurt, and eating at the hive heals
export const BEE_HEALTH = 10;
export const WASP_HEALTH = 30;
export const HEALTH_PER_HONEY = 2; // health each honey eaten restores
export const STING_DAMAGE = 5; // a wasp's sting; wasps sting as often as they like
export const BEE_STING_DAMAGE = 10; // a worker bee's one sting, which kills the bee when it lands
export const STING_TICKS = 6;
export const STEAL_TICKS = 10;

// wasps: a colony saves up for a wasp nest (the queen builds it with build_nest), and then the queen
// can lay wasps, which hatch at the nest. They sting, guard and raid, but can't collect nectar.
export const NEST_COST = 150; // honey for a colony's wasp nest
export const NEST_BUILD_TICKS = 100;
export const WASP_COST = 30; // honey per wasp egg, once there's a nest
export const BEE_CAPACITY = 3;
export const WASP_CAPACITY = 6; // honey a wasp can carry off in a raid

// wild wasp nests (multiplayer): neutral, on unclaimed maps, stinging anyone's bees and wasps nearby
export const WILD_NESTS = 3; // per world
export const NEST_SPOT = { x: 12, y: 5 }; // where a nest hangs inside its map
export const NEST_HEALTH = 60;
export const NEST_WASPS = 4; // wild wasps a nest keeps
export const NEST_SPAWN_TICKS = 600; // ticks between new wild wasps, while it has fewer than NEST_WASPS
export const VISITOR_CHANCE = 0.5; // single player: the chance a lone wild wasp arrives as a season with flowers starts
export const VISITOR_KILLS = 5; // bees a visitor stings to death before it's had its fill and flies off
export const VISITOR_REST = 300; // ticks a visitor rests (eats) after each kill
export const VISITOR_PATIENCE = 600; // ticks a visitor hunts without a kill before it gives up and flies off
export const WILD_WANDER = 6; // tiles from the nest a wild wasp roams when it sees no one (never off the nest's map)

// seasons
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_TICKS = 2700; // 3 minutes at 1x; a year is four seasons
/** Ticks for a flower to regrow one nectar; nothing grows in winter. */
export const REGEN_TICKS: Record<Season, number> = { spring: 130, summer: 80, autumn: 260, winter: Infinity };
export const WINTER_IDLE = 0.12; // keeping warm burns energy even at rest: about 8 honey per bee over a winter
export const WINTER_FLIGHT = 2; // flying costs twice as much in the cold
export const WINTER_AGING = 0.5; // resting in the winter cluster, bees age at half speed

const LOG_LIMIT = 500;
const FALLEN_LIMIT = 30;

// ---- types ----

export type Dir = 'north' | 'south' | 'east' | 'west';
export const DIRS: Dir[] = ['north', 'south', 'east', 'west'];
export const STEP: Record<Dir, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** The scripts a colony runs: one per role, the queen's, and code shared by every role. */
export interface Programs {
  forager: Stmt[];
  queen: Stmt[];
  roles?: Record<string, Stmt[]>; // custom roles by name
  wasp?: Stmt[]; // what every wasp runs
  shared?: Stmt[]; // runs ahead of every role's script; parse it with firstLine SHARED_LINE_BASE + 1
}
/** A script file's name without ".bee": "queen", "shared", "forager" or a custom role's name. */
export type ScriptFile = string;

/** Which file a line of a worker's program is in: shared.bee's lines are numbered past SHARED_LINE_BASE. */
export function locate(role: string, line: number): { file: ScriptFile; line: number } {
  return line > SHARED_LINE_BASE ? { file: 'shared', line: line - SHARED_LINE_BASE } : { file: role, line };
}

export interface Tile {
  x: number;
  y: number;
}

/** A number for a tile, for keying maps by position; worlds are never 1024 tiles wide. */
export const tileKey = (x: number, y: number): number => y * 1024 + x;
export const keyTile = (key: number): Tile => ({ x: key % 1024, y: Math.floor(key / 1024) });

export interface Flower extends Tile {
  kind: FlowerKind;
  nectar: number;
  max: number; // nectar it holds when full
  regen: number;
  color: number; // which of its kind's two shades it is drawn in
}

export type Action =
  // moving: false while waiting for the next tile to be free; waited: blocked ticks so far; single: from move(), which never steers
  | { kind: 'move'; path: Tile[]; target: Tile; stepLeft: number; moving: boolean; waited: number; single: boolean }
  | { kind: 'collect' | 'deposit' | 'eat' | 'build' | 'wait' | 'bump' | 'steal'; left: number }
  | { kind: 'mark'; left: number; scent: string }
  | { kind: 'sting'; left: number; target: Tile };
type MoveAction = Extract<Action, { kind: 'move' }>;

export type DeathCause = 'old age' | 'starved' | 'by choice' | 'stung' | 'last sting';

export interface BeeStats {
  collected: number; // nectar picked up
  delivered: number; // honey made at the hive
  tilesFlown: number;
  honeyEaten: number;
  built: number; // cells of comb
  stolen?: number; // honey taken from other hives
  stings?: number; // stings that hit
}

export interface Bee extends Tile {
  id: number;
  role: string; // fixed for life
  facing: Dir;
  carrying: number;
  capacity: number;
  energy: number;
  health: number;
  maxHealth: number;
  age: number; // ticks lived; grows at half speed in winter
  lifespan: number; // ticks it will live, if it doesn't starve first
  bornAt: number; // tick it hatched
  action: Action | null;
  runner: Runner;
  stats: BeeStats;
  death: { cause: DeathCause; tick: number } | null;
}

/** A wild wasp nest: it keeps a few wild wasps, which sting anyone's units that come near. */
export interface Nest extends Tile {
  id: number;
  health: number;
  maxHealth: number;
  wasps: Bee[]; // wild wasps run no script; World.stepWild decides for them
  spawnIn: number; // ticks until the next wild wasp, while there are fewer than NEST_WASPS
  /** Where each wild wasp is wandering to, by wasp id. */
  roam: Record<number, Tile>;
  /**
   * A lone wild wasp visiting single player's meadow, not a real nest: nothing is drawn or can be
   * stung here, the tile is just its anchor (the map's middle, or the edge it's leaving by).
   */
  visitor?: { leaving: boolean; kills: number; lastKill: number }; // lastKill: the tick of its last kill, or its arrival
}

/** The queen never leaves the hive and never dies; her script decides when to lay. */
export interface Queen {
  runner: Runner;
  action: { kind: 'lay' | 'wait'; left: number } | { kind: 'nest'; left: number; target: Tile } | null;
  laid: number;
}

/** A colony's own wasp nest: built with honey, where its wasps hatch; enemy wasps can destroy it. */
export interface ColonyNest extends Tile {
  health: number;
  maxHealth: number;
}

export interface Egg {
  role: string;
  laidAt: number;
  hatchAt: number;
}

// Everything happens somewhere, so a viewer of one map can keep only what happened on it.
export type WorldEvent =
  | { type: 'collect'; x: number; y: number }
  | { type: 'deposit'; x: number; y: number; amount: number }
  | { type: 'lay' | 'build'; x: number; y: number }
  | { type: 'hatch'; x: number; y: number; id: number }
  | { type: 'death'; id: number; role: string; x: number; y: number; facing: Dir; cause: DeathCause }
  | { type: 'hit'; id: number; x: number; y: number } // a unit (or a nest, id 0) took a sting
  | { type: 'steal'; x: number; y: number; amount: number }
  | { type: 'nest'; x: number; y: number }; // a nest was destroyed

export interface LogLine {
  seq: number; // counts every line the colony has ever logged, so a viewer can tell new lines from old
  tick: number;
  who: number | 'queen' | null; // a bee id, the queen, or the colony itself
  text: string;
  tone?: 'error' | 'death' | 'season' | 'note' | 'raid'; // no tone: something a script printed; raid: raids and fights
}

/** Optional starting state, used by the docs' example clips, by tests and by the server. */
export interface WorldOptions {
  bees?: number;
  honey?: number;
  tick?: number; // start partway through the year, e.g. late autumn
  energy?: number; // starting energy for the first bees
  health?: number; // starting health for the first bees
  comb?: number;
  /** A fixed meadow: these tiles bloom with each season's flower instead of seeded patches. */
  flowers?: [number, number][];
  /**
   * Whether a script error stops the whole world (the default, as in single player, so the
   * mistake is easy to find). The multiplayer server turns it off: only the bee or queen whose
   * script failed stops, and the world keeps running.
   */
  haltOnError?: boolean;
  /**
   * A multiplayer world: this many maps across and down, with no colony until players found
   * them, and a clock that keeps running with no colonies at all. Without it, the world is
   * single player's one map with one colony.
   */
  maps?: [number, number];
  /** Wild wasp nests: how many to hang on random free maps, or where (for the docs' clips). */
  nests?: number | [number, number][];
  /** Wild wasps each nest starts with (NEST_WASPS by default). */
  nestWasps?: number;
  /** Wasps the colony starts with, after its foragers (for the docs' clips). */
  wasps?: number;
  /** Another colony's hive on the same map, with honey in it and no bees (for the docs' clips). */
  rival?: { x: number; y: number; honey: number; owner: string; shielded?: boolean };
  /** A wasp nest the colony already has (for the docs' clips). */
  nest?: [number, number];
  /** Hedgerows along every border between maps and around the world, with one gate per border (multiplayer). */
  hedges?: boolean;
  /** With maps: still found single player's colony on map [0, 0] (the docs' clips of a hedged world). */
  home?: boolean;
  /** Single player: now and then a lone wild wasp visits for a season (VISITOR_CHANCE). */
  visitors?: boolean;
  /** Where single player's hive sits, if not at HIVE_SPOT. */
  hive?: Tile;
}

type Body = Omit<Bee, 'runner'>;

/** One colony as plain JSON: bodies and stores, no running scripts. */
export interface ColonySave {
  id: number;
  owner: string | null;
  map: Tile;
  hive?: Tile;
  nest?: ColonyNest | null;
  shielded?: boolean;
  shieldEnds?: number | null;
  foundedAt?: number;
  stolen?: number;
  kills?: number;
  honey: number;
  totalHoney: number;
  deaths: number;
  comb: number;
  scents: [number, [string, number][]][];
  bees: Body[];
  fallen: Body[];
  eggs: Egg[];
  queen: { action: Queen['action']; laid: number } | null;
  log: LogLine[];
  logCount: number;
  emptyFor: number;
  over: string | null;
}

/** A world as plain JSON (see World.save and World.restore). */
export interface WorldSave {
  version: 2;
  seed: number;
  tick: number;
  maps: [number, number];
  persistent: boolean;
  flowers: Flower[];
  rng: number;
  nextId: number;
  nextColonyId: number;
  colonies: ColonySave[];
  nests?: (Omit<Nest, 'wasps'> & { wasps: Body[] })[];
  nextNestId?: number;
  nestsToRegrow?: number;
  hedges?: boolean;
}

export interface WorldError {
  message: string;
  line: number;
  file: ScriptFile;
  beeId: number | null;
}

/**
 * One player's colony: a hive on one map, its queen, bees, eggs, honey and comb, the scent its
 * bees leave, and its log. The land, the flowers and the clock belong to the World it lives in.
 */
export class Colony {
  honey = 0;
  totalHoney = 0;
  deaths = 0;
  comb = START_COMB;
  readonly hive: Tile;
  readonly bees: Bee[] = [];
  readonly eggs: Egg[] = [];
  queen: Queen | null = null;
  /** Bees that died recently, newest last, so the inspector can still show them. */
  readonly fallen: Bee[] = [];
  readonly log: LogLine[] = [];
  /** How many lines have ever been logged; the next line's seq. */
  logCount = 0;
  /** Scent marks this colony's bees left: tileKey -> scent name -> the tick it was last marked. Only they can smell them. */
  readonly scents = new Map<number, Map<string, number>>();
  /** Set when the colony has died out. */
  over: string | null = null;
  emptyFor = 0;
  /** The tick the colony was founded. */
  foundedAt = 0;
  /** Honey its units have stolen from other hives, and enemy units (and nests) they've stung to death. */
  stolen = 0;
  kills = 0;
  /** The colony's wasp nest, once the queen has built one. */
  nest: ColonyNest | null = null;
  /**
   * A new colony's protection (multiplayer): other players can't raid or sting it, and wild wasps
   * leave it alone. The server starts and ends it by real time (shieldEnds, in ms); attacking
   * another player ends it early.
   */
  shielded = false;
  shieldEnds: number | null = null;
  /** Whether the log has explained that wasps need a nest (once is enough). */
  waspNoteShown = false;

  constructor(
    readonly world: World,
    readonly id: number,
    /** Which map the hive is on, as [column, row] of maps. */
    readonly map: Tile,
    public programs: Programs | null,
    /** The player's name in multiplayer; null in single player. */
    readonly owner: string | null = null,
    hive?: Tile,
  ) {
    this.hive = hive ?? { x: map.x * COLS + HIVE_SPOT.x, y: map.y * ROWS + HIVE_SPOT.y };
    this.foundedAt = world.tick;
    this.viewMap = map;
  }

  /** How the colony is named to others: its player's name. */
  get name(): string {
    return this.owner ?? 'you';
  }

  // the world as this colony sees it, so a colony can be drawn on its own (see ColonyView)
  get tick(): number {
    return this.world.tick;
  }
  get season(): Season {
    return this.world.season;
  }
  get year(): number {
    return this.world.year;
  }
  get seasonLeft(): number {
    return this.world.seasonLeft;
  }
  get flowers(): Flower[] {
    return this.world.flowers;
  }
  get events(): WorldEvent[] {
    return this.world.events;
  }
  set events(events: WorldEvent[]) {
    this.world.events = events;
  }
  /** The map a screen showing this colony is looking at: its own, unless changed (the tutorial's practice worlds). */
  viewMap: Tile;
  /** The top-left tile of the map on screen. */
  get origin(): Tile {
    return { x: this.viewMap.x * COLS, y: this.viewMap.y * ROWS };
  }
  private onMap(t: Tile): boolean {
    const o = this.origin;
    return t.x >= o.x - 1 && t.x <= o.x + COLS && t.y >= o.y - 1 && t.y <= o.y + ROWS;
  }
  /** Other colonies' hives on this colony's map (a docs clip's rival hive; in multiplayer a map holds one hive). */
  get otherHives(): { x: number; y: number; owner: string | null; shielded: boolean; honey: number }[] {
    return this.world.colonies.filter(c => c !== this && this.onMap(c.hive)).map(c => ({ ...c.hive, owner: c.owner, shielded: c.shielded, honey: c.honey }));
  }
  /** Other colonies' units standing on this hive, raiding it (wild wasps never go into a hive). */
  get raiders(): { owner: string | null; role: string }[] {
    return this.world.colonies.flatMap(c => (c === this ? [] : c.bees.filter(b => this.atHive(b)).map(b => ({ owner: c.owner, role: b.role }))));
  }
  /** Other colonies' units, and wild wasps (owner null), on or just at the edge of this colony's map. */
  get visitors(): (Body & { owner: string | null })[] {
    const out: (Body & { owner: string | null })[] = [];
    for (const c of this.world.colonies) {
      if (c === this) continue;
      for (const { runner: _runner, ...b } of c.bees) if (this.onMap(b)) out.push({ ...b, owner: c.owner });
    }
    for (const n of this.world.nests) for (const { runner: _runner, ...w } of n.wasps) if (this.onMap(w)) out.push({ ...w, owner: null });
    return out;
  }
  /** Hedge tiles on the map on screen, and just past its edges. */
  get hedges(): number[] {
    if (!this.world.hedges.size) return [];
    return [...this.world.hedges].filter(k => this.onMap(keyTile(k)));
  }
  /** Every nest on the map on screen: wild ones, and colonies' own (this one's included). */
  get nests(): { x: number; y: number; health: number; maxHealth: number; owner: string | null; wild: boolean }[] {
    const wild = this.world.nests.filter(n => !n.visitor).map(({ x, y, health, maxHealth }) => ({ x, y, health, maxHealth, owner: null, wild: true }));
    const owned = this.world.colonies.flatMap(c => (c.nest ? [{ ...c.nest, owner: c.owner, wild: false }] : []));
    return [...wild, ...owned].filter(n => this.onMap(n));
  }

  /** Free cells of comb: room for more eggs. Wasps live in their nest, so they need none. */
  get space(): number {
    return combFree(this.comb, this.bees, this.eggs);
  }

  /** Every role's name: forager, the custom roles, then wasp. */
  get roleNames(): string[] {
    return ['forager', ...Object.keys(this.programs?.roles ?? {}), 'wasp'];
  }

  get running(): boolean {
    return this.programs !== null && this.over === null;
  }

  atHive(tile: Tile): boolean {
    return tile.x === this.hive.x && tile.y === this.hive.y;
  }

  flowerAt(x: number, y: number): Flower | null {
    return this.world.flowerAt(x, y);
  }

  /** A living or recently fallen bee. */
  findBee(id: number | null): Bee | null {
    if (id === null) return null;
    return this.bees.find(b => b.id === id) ?? this.fallen.find(b => b.id === id) ?? null;
  }

  /** How strong a scent is on a tile: SCENT_MAX when just marked, fading evenly to 0. */
  scentAt(x: number, y: number, name: string): number {
    const at = this.scents.get(tileKey(x, y))?.get(name);
    return at === undefined ? 0 : scentStrength(this.tick, at);
  }

  /** Every scent on a tile with its strength, strongest first. */
  scentsAt(x: number, y: number): [string, number][] {
    const marks = this.scents.get(tileKey(x, y));
    if (!marks) return [];
    return [...marks]
      .map(([name, at]): [string, number] => [name, scentStrength(this.tick, at)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]);
  }

  /** The tile within a bee's sight where this scent is strongest; the closer tile wins a tie. */
  strongestScent(bee: Bee, name: string): Tile | null {
    let best: Tile | null = null;
    let bestStrength = 0;
    let bestDist = Infinity;
    for (const [key, marks] of this.scents) {
      const at = marks.get(name);
      if (at === undefined) continue;
      const tile = keyTile(key);
      const strength = scentStrength(this.tick, at);
      const d = Math.hypot(tile.x - bee.x, tile.y - bee.y);
      if (strength > 0 && d <= SMELL_RANGE && (strength > bestStrength || (strength === bestStrength && d < bestDist))) {
        best = tile;
        bestStrength = strength;
        bestDist = d;
      }
    }
    return best;
  }

  say(who: Bee | 'queen' | null, text: string, tone?: LogLine['tone']): void {
    this.log.push({ seq: this.logCount++, tick: this.tick, who: who === 'queen' || who === null ? who : who.id, text, tone });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  /**
   * Swaps in new scripts while the world runs. At the next tick every bee and the queen start
   * the new code from the top; their bodies (position, energy, cargo, age) stay as they are.
   */
  deploy(programs: Programs): void {
    this.programs = programs;
    this.world.error = null;
    if (this.queen) {
      this.queen.runner = queenRunner(this, programs);
      this.queen.action = null;
    }
    for (const bee of this.bees) {
      bee.action = null;
      bee.runner = this.runnerFor(bee);
    }
  }

  /** A fresh runner for a bee's role: shared.bee first, so its functions exist before the role's code needs them. */
  runnerFor(bee: Bee): Runner {
    const programs = this.programs!;
    const own = bee.role === 'forager' ? programs.forager : bee.role === 'wasp' ? programs.wasp : programs.roles?.[bee.role];
    if (!own) {
      this.say(bee, `There is no ${bee.role}.bee any more, so this bee has nothing to run.`, 'note');
      return new Runner([], beeGlobals(this, bee));
    }
    return new Runner([...(programs.shared ?? []), ...own], beeGlobals(this, bee));
  }

  save(): ColonySave {
    const body = ({ runner: _runner, ...rest }: Bee) => rest;
    return {
      id: this.id, owner: this.owner, map: this.map, hive: this.hive, nest: this.nest, foundedAt: this.foundedAt, stolen: this.stolen, kills: this.kills,
      shielded: this.shielded, shieldEnds: this.shieldEnds,
      honey: this.honey, totalHoney: this.totalHoney, deaths: this.deaths, comb: this.comb,
      scents: [...this.scents].map(([key, marks]) => [key, [...marks]]),
      bees: this.bees.map(body),
      fallen: this.fallen.map(body),
      eggs: this.eggs,
      queen: this.queen && { action: this.queen.action, laid: this.queen.laid },
      log: this.log.slice(-100),
      logCount: this.logCount,
      emptyFor: this.emptyFor,
      over: this.over,
    };
  }
}

/**
 * The whole simulation: the land (one map in single player, a grid of maps in multiplayer),
 * its flowers and clock, and the colonies on it. It only changes in step(), one tick at a time,
 * and draws its randomness from a seed, so the same scripts and seed always play out the same.
 */
export class World {
  tick = 0;
  /** Maps across and down. */
  readonly maps: [number, number];
  /** Size in tiles. */
  readonly width: number;
  readonly height: number;
  /** What is in bloom now, on every map; replaced each season, and empty in winter. */
  flowers: Flower[];
  readonly colonies: Colony[] = [];
  /** Wild wasp nests (multiplayer, and some docs clips). */
  readonly nests: Nest[] = [];
  /** Things that happened since the renderer last looked; it clears them. */
  events: WorldEvent[] = [];
  /** Single player: a script error that stopped the world. */
  error: WorldError | null = null;
  rng: Rng;
  readonly haltOnError: boolean;
  /** Multiplayer: the clock runs whether or not any colony is alive. */
  readonly persistent: boolean;
  /** Hedge tiles (tileKey), which nothing flies into; empty without hedges. */
  readonly hedges: Set<number>;
  /** The gaps in the hedges between maps: two tiles per border. */
  readonly gateTiles: Tile[];
  private readonly planCache = new Map<string, Tile[]>(); // routes around hedges, for this tick
  private planTick = -1;
  private nextId = 1;
  private nextColonyId = 1;
  private nextNestId = 1;
  /** Nests destroyed this year; each hangs again on a free map next spring. */
  private nestsToRegrow = 0;
  /** Single player: lone wild wasps may visit. */
  private readonly visitorsOn: boolean;
  private readonly fixedFlowers: [number, number][] | null;
  private flowerIndex = new Map<number, Flower>();
  private indexed: Flower[] | null = null;

  constructor(
    programs: Programs | null,
    readonly seed = 1,
    options: WorldOptions = {},
  ) {
    this.rng = mulberry32(seed);
    this.haltOnError = options.haltOnError ?? true;
    this.persistent = options.maps !== undefined;
    this.maps = options.maps ?? [1, 1];
    this.width = this.maps[0] * COLS;
    this.height = this.maps[1] * ROWS;
    this.fixedFlowers = options.flowers ?? null;
    this.visitorsOn = !!options.visitors;
    this.tick = options.tick ?? 0;
    const layout = options.hedges ? hedgeLayout(seed, this.maps) : { hedges: new Set<number>(), gates: [] };
    this.hedges = layout.hedges;
    this.gateTiles = layout.gates;
    this.flowers = this.grow();
    const nests = options.nests ?? 0;
    if (typeof nests === 'number') for (let i = 0; i < nests; i++) this.hangNest();
    else for (const [x, y] of nests) this.addNest({ x, y }, options.nestWasps ?? NEST_WASPS);
    if (this.persistent && !options.home) return;
    // single player: one colony on the one map, idle until there are scripts
    const colony = this.addColony(programs, { x: 0, y: 0 }, null, options.hive);
    if (options.hive) this.flowers = this.grow(); // nothing grows under the hive
    colony.honey = options.honey ?? 0;
    colony.comb = options.comb ?? START_COMB;
    if (options.rival) {
      const { x, y, honey, owner, shielded } = options.rival;
      const rival = this.addColony(null, { x: 0, y: 0 }, owner, { x, y });
      rival.honey = honey;
      rival.shielded = !!shielded;
    }
    if (!programs) return;
    this.startColony(colony, options.bees ?? START_BEES);
    for (let i = 0; i < (options.wasps ?? 0); i++) this.spawn(colony, 'wasp');
    if (options.energy !== undefined) for (const bee of colony.bees) bee.energy = options.energy;
    if (options.health !== undefined) for (const bee of colony.bees) bee.health = options.health;
    if (options.nest) colony.nest = { x: options.nest[0], y: options.nest[1], health: NEST_HEALTH, maxHealth: NEST_HEALTH };
  }

  /** Single player's colony (the first one there is). */
  get colony(): Colony {
    return this.colonies[0];
  }

  get running(): boolean {
    return this.error === null && (this.persistent || this.colonies.some(c => c.running));
  }

  get season(): Season {
    return seasonAt(this.tick);
  }

  get year(): number {
    return yearAt(this.tick);
  }

  /** Ticks until the season changes. */
  get seasonLeft(): number {
    return seasonLeftAt(this.tick);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Whether nothing can fly into a tile: outside the world, or a hedge. */
  blocked(tile: Tile): boolean {
    return !this.inside(tile.x, tile.y) || this.hedges.has(tileKey(tile.x, tile.y));
  }

  /**
   * The tiles to fly through from one tile to another, not including the start; [] when it
   * can't be reached. An L-shaped route when one is clear of hedges (always, on an open map),
   * otherwise the shortest way around them. Other units are left to claim() and steer().
   */
  plan(from: Tile, to: Tile, xFirst = true): Tile[] {
    const first = route(from, to, xFirst);
    if (!this.hedges.size) return first;
    const clear = (path: Tile[]) => path.every(t => !this.hedges.has(tileKey(t.x, t.y)));
    if (clear(first)) return first;
    const other = route(from, to, !xFirst);
    if (clear(other)) return other;
    if (this.blocked(to)) return [];
    if (this.planTick !== this.tick) {
      this.planCache.clear();
      this.planTick = this.tick;
    }
    const key = `${from.x},${from.y}>${to.x},${to.y}`;
    let path = this.planCache.get(key);
    if (!path) this.planCache.set(key, (path = this.search(from, to)));
    return path.map(t => ({ ...t }));
  }

  /** How many tiles a bee flies between two tiles, going around hedges (Manhattan distance on an open map). */
  travel(a: Tile, b: Tile): number {
    const straight = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (!this.hedges.size || straight === 0) return straight;
    return this.plan(a, b).length || straight; // can't be reached: the straight count is the best answer there is
  }

  /** A* over the tiles that aren't hedge: 4 directions, Manhattan distance to go, ties to the lower tile. */
  private search(from: Tile, to: Tile): Tile[] {
    const W = this.width;
    const n = W * this.height;
    const cost = new Int32Array(n).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    const start = from.y * W + from.x;
    const goal = to.y * W + to.x;
    const h = (i: number) => Math.abs((i % W) - to.x) + Math.abs(Math.floor(i / W) - to.y);
    const heap: [number, number][] = []; // [f, tile], smallest first
    const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = (item: [number, number]) => {
      heap.push(item);
      for (let i = heap.length - 1; i > 0; ) {
        const up = (i - 1) >> 1;
        if (!less(heap[i], heap[up])) break;
        [heap[i], heap[up]] = [heap[up], heap[i]];
        i = up;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top;
    };
    cost[start] = 0;
    push([h(start), start]);
    while (heap.length) {
      const [, i] = pop();
      if (i === goal) break;
      const x = i % W;
      const y = Math.floor(i / W);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (this.blocked({ x: nx, y: ny })) continue;
        const j = ny * W + nx;
        const c = cost[i] + 1;
        if (cost[j] !== -1 && cost[j] <= c) continue;
        cost[j] = c;
        prev[j] = i;
        push([c + h(j), j]);
      }
    }
    if (cost[goal] === -1) return [];
    const path: Tile[] = [];
    for (let i = goal; i !== start; i = prev[i]) path.push({ x: i % W, y: Math.floor(i / W) });
    return path.reverse();
  }

  /** The gate tiles on the borders of a map, nearest to a tile first. */
  gatesOf(map: Tile, near: Tile): Tile[] {
    const x0 = map.x * COLS;
    const y0 = map.y * ROWS;
    const onBorder = (t: Tile) =>
      ((t.x === x0 || t.x === x0 + COLS) && t.y >= y0 && t.y < y0 + ROWS) || ((t.y === y0 || t.y === y0 + ROWS) && t.x >= x0 && t.x < x0 + COLS);
    const d = (t: Tile) => Math.abs(t.x - near.x) + Math.abs(t.y - near.y);
    return this.gateTiles.filter(onBorder).sort((a, b) => d(a) - d(b) || tileKey(a.x, a.y) - tileKey(b.x, b.y));
  }

  /** The map a tile is on, as [column, row] of maps. */
  mapAt(tile: Tile): Tile {
    return { x: Math.floor(tile.x / COLS), y: Math.floor(tile.y / ROWS) };
  }

  /** The colony whose hive is on a map, if any. */
  colonyOn(map: Tile): Colony | null {
    return this.colonies.find(c => c.map.x === map.x && c.map.y === map.y) ?? null;
  }

  flowerAt(x: number, y: number): Flower | null {
    if (this.indexed !== this.flowers) {
      this.flowerIndex = new Map(this.flowers.map(f => [tileKey(f.x, f.y), f]));
      this.indexed = this.flowers;
    }
    return this.flowerIndex.get(tileKey(x, y)) ?? null;
  }

  /** Whether a tile is any colony's hive. */
  isHive(tile: Tile): boolean {
    return this.colonies.some(c => c.atHive(tile));
  }

  nestAt(tile: Tile): Nest | null {
    return this.nests.find(n => !n.visitor && n.x === tile.x && n.y === tile.y) ?? null;
  }

  /** The colony whose own wasp nest is on a tile, if any. */
  colonyNestAt(tile: Tile): Colony | null {
    return this.colonies.find(c => c.nest && c.nest.x === tile.x && c.nest.y === tile.y) ?? null;
  }

  /** The wild nest hanging on a map, if any. */
  nestOn(map: Tile): Nest | null {
    return this.nests.find(n => !n.visitor && this.mapAt(n).x === map.x && this.mapAt(n).y === map.y) ?? null;
  }

  /**
   * Whether another unit is on this tile or flying into it. Only one fits on a tile;
   * hives and nests are the exception, since everyone goes inside.
   */
  taken(tile: Tile, by: Bee | null = null): boolean {
    if (this.isHive(tile) || this.nestAt(tile) || this.colonyNestAt(tile)) return false;
    const blocks = (b: Bee) => {
      if (b === by) return false;
      if (b.x === tile.x && b.y === tile.y) return true;
      const a = b.action;
      return a?.kind === 'move' && a.moving && a.path[0].x === tile.x && a.path[0].y === tile.y;
    };
    for (const c of this.colonies) for (const b of c.bees) if (blocks(b)) return true;
    for (const n of this.nests) for (const w of n.wasps) if (blocks(w)) return true;
    return false;
  }

  /** Units a colony counts as enemies within a bee's sight, nearest first: other colonies' bees and wasps, and wild wasps. */
  enemiesNear(colony: Colony, bee: Bee): Bee[] {
    const near: [Bee, number][] = [];
    const consider = (b: Bee) => {
      const d = Math.hypot(b.x - bee.x, b.y - bee.y);
      if (d <= SENSE_RANGE) near.push([b, d]);
    };
    for (const c of this.colonies) if (c !== colony && !c.shielded) for (const b of c.bees) consider(b); // a protected colony can't be fought
    for (const n of this.nests) for (const w of n.wasps) consider(w);
    return near.sort((a, b) => a[1] - b[1] || a[0].id - b[0].id).map(([b]) => b);
  }

  /** Whether what's on a tile (a hive, a colony's nest, or a unit) belongs to a protected new colony. */
  shieldedAt(tile: Tile): boolean {
    const c = this.colonies.find(c => c.atHive(tile)) ?? this.colonyNestAt(tile) ?? this.colonies.find(c => c.bees.some(b => b.x === tile.x && b.y === tile.y));
    return !!c?.shielded;
  }

  /** Whose a tile is: a hive's or nest's owner, else the owner of a unit on it ("wild" for wild wasps), else null. */
  ownerAt(tile: Tile): string | null {
    const hive = this.colonies.find(c => c.atHive(tile)) ?? this.colonyNestAt(tile);
    if (hive) return hive.name;
    if (this.nestAt(tile)) return 'wild';
    for (const c of this.colonies) if (c.bees.some(b => b.x === tile.x && b.y === tile.y)) return c.name;
    for (const n of this.nests) if (n.wasps.some(w => w.x === tile.x && w.y === tile.y)) return 'wild';
    return null;
  }

  /**
   * Every flower within the bee's sight, nearest first (ties: top row first, then left), taken or
   * not. Only ones with nectar, unless empty ones are asked for too (they refill, so a map wants them).
   */
  flowersNear(bee: Bee, withEmpty = false): Flower[] {
    const near: [Flower, number][] = [];
    for (const f of this.flowers) {
      const d = Math.hypot(f.x - bee.x, f.y - bee.y);
      if ((withEmpty || f.nectar >= 1) && d <= SENSE_RANGE) near.push([f, d]);
    }
    return near.sort((a, b) => a[1] - b[1] || tileKey(a[0].x, a[0].y) - tileKey(b[0].x, b[0].y)).map(([f]) => f);
  }

  /** The nectar left in a flower within the bee's sight (0 when it's empty), or null: no flower there, or out of sight. */
  nectarAt(bee: Bee, tile: Tile): number | null {
    if (Math.hypot(tile.x - bee.x, tile.y - bee.y) > SENSE_RANGE) return null;
    return this.flowerAt(tile.x, tile.y)?.nectar ?? null;
  }

  /** The closest flower that still has nectar and no other bee on it, within the bee's sight. */
  nearestFlower(bee: Bee): Flower | null {
    let best: Flower | null = null;
    let bestDist = Infinity;
    for (const f of this.flowers) {
      if (f.nectar < 1) continue;
      const d = Math.hypot(f.x - bee.x, f.y - bee.y);
      if (d <= SENSE_RANGE && d < bestDist && !this.taken(f, bee)) {
        best = f;
        bestDist = d;
      }
    }
    return best;
  }

  /** Why a colony's hive can't go on a tile of a map, or null when it can (see hiveProblem). */
  hiveProblem(map: Tile, hive: Tile): string | null {
    return hiveProblem(map, hive, {
      flowerAt: (x, y) => !!this.flowerAt(x, y),
      hedgeAt: (x, y) => this.hedges.has(tileKey(x, y)),
      nestAt: t => !!(this.nestAt(t) || this.colonyNestAt(t)),
    });
  }

  /** The tile nearest to a spot where a hive can go on a map (HIVE_SPOT's when none can). */
  nearestHiveSpot(map: Tile, from: Tile): Tile {
    let best: Tile | null = null;
    let bestDist = Infinity;
    for (let y = map.y * ROWS; y < (map.y + 1) * ROWS; y++) {
      for (let x = map.x * COLS; x < (map.x + 1) * COLS; x++) {
        const d = Math.abs(x - from.x) + Math.abs(y - from.y);
        if (d < bestDist && !this.hiveProblem(map, { x, y })) {
          best = { x, y };
          bestDist = d;
        }
      }
    }
    return best ?? { x: map.x * COLS + HIVE_SPOT.x, y: map.y * ROWS + HIVE_SPOT.y };
  }

  /**
   * Founds a colony with a queen and its first bees on a free map (multiplayer), its hive at
   * HIVE_SPOT unless placed elsewhere. The caller checks the map is free and the hive can go there.
   */
  found(programs: Programs, map: Tile, owner: string | null, hive?: Tile, start = { bees: START_BEES, honey: 0 }): Colony {
    const colony = this.addColony(programs, map, owner, hive);
    colony.honey = start.honey;
    this.startColony(colony, start.bees);
    return colony;
  }

  /** Takes a colony off the world, freeing its map; its bees are gone with it. */
  remove(colony: Colony): void {
    const i = this.colonies.indexOf(colony);
    if (i >= 0) this.colonies.splice(i, 1);
  }

  private addColony(programs: Programs | null, map: Tile, owner: string | null, hive?: Tile): Colony {
    const colony = new Colony(this, this.nextColonyId++, map, programs, owner, hive);
    this.colonies.push(colony);
    return colony;
  }

  private startColony(colony: Colony, bees: number): void {
    colony.queen = { runner: queenRunner(colony, colony.programs!), action: null, laid: 0 };
    for (let i = 0; i < bees; i++) this.spawn(colony);
  }

  step(): void {
    if (!this.running) return;
    const before = this.season;
    this.tick++;
    if (this.season !== before) this.changeSeason();

    const regen = REGEN_TICKS[this.season];
    for (const f of this.flowers) {
      if (f.nectar < f.max && ++f.regen >= regen) {
        f.nectar++;
        f.regen = 0;
      }
    }
    for (const colony of [...this.colonies]) {
      if (!colony.running) continue;
      if (this.tick % 60 === 0) fadeScents(colony);
      for (const bee of [...colony.bees]) {
        this.stepBee(colony, bee);
        if (this.error) return;
      }
      this.stepQueen(colony);
      if (this.error) return;
      while (colony.eggs.length && colony.eggs[0].hatchAt <= this.tick) {
        const egg = colony.eggs.shift()!;
        const bee = this.spawn(colony, egg.role);
        colony.say(bee, 'Hatched.', 'note');
      }
      checkSurvival(colony);
    }
    for (const nest of [...this.nests]) this.stepNest(nest);
  }

  /** This season's flowers: the fixed meadow if there is one, otherwise seeded patches on every map. */
  private grow(): Flower[] {
    const season = this.season;
    if (season === 'winter') return [];
    if (this.fixedFlowers) {
      const b = BLOOMS[season];
      return this.fixedFlowers.map(([x, y]) => ({ x, y, kind: b.kind, nectar: b.nectar, max: b.nectar, regen: 0, color: (x + y) % 2 }));
    }
    const flowers: Flower[] = [];
    for (let my = 0; my < this.maps[1]; my++) {
      for (let mx = 0; mx < this.maps[0]; mx++) flowers.push(...bloomMap(this.seed, { x: mx, y: my }, this.year, season, this.colonies.map(c => c.hive)));
    }
    return flowers.filter(f => !this.hedges.has(tileKey(f.x, f.y))); // nothing grows in a hedge
  }

  private changeSeason(): void {
    this.flowers = this.grow();
    const s = this.season;
    const text =
      s === 'spring' ? `Spring, year ${this.year}: clover is blooming in a few patches around the hive.`
      : s === 'summer' ? 'Summer: the clover is over, and lavender blooms all across the meadow. Flowers regrow fastest now.'
      : s === 'autumn' ? 'Autumn: the last flowers, goldenrod, grow in a few rich patches far from the hive. Store honey for winter.'
      : 'Winter: the flowers are gone until spring, and keeping warm burns more energy.';
    for (const c of this.colonies) if (c.running) c.say(null, text, 'season');
    if (this.visitorsOn) this.visitorsAtSeason(s);
    if (s === 'spring') {
      // destroyed nests hang again, each on a free map
      for (let n = this.nestsToRegrow; n > 0; n--) if (this.hangNest()) this.nestsToRegrow--;
    }
  }

  /** Everything needed to rebuild this world later. Scripts start from the top on restore. */
  save(): WorldSave {
    return {
      version: 2,
      seed: this.seed, tick: this.tick, maps: this.maps, persistent: this.persistent, hedges: this.hedges.size > 0,
      flowers: this.flowers,
      rng: this.rng.state(),
      nextId: this.nextId,
      nextColonyId: this.nextColonyId,
      colonies: this.colonies.map(c => c.save()),
      nests: this.nests.map(({ wasps, ...n }) => ({ ...n, wasps: wasps.map(({ runner: _runner, ...w }) => w) })),
      nextNestId: this.nextNestId,
      nestsToRegrow: this.nestsToRegrow,
    };
  }

  /**
   * Rebuilds a saved world. Each colony runs the scripts given for it (one set for every colony,
   * or a lookup), starting from the top; a colony with no scripts is left out.
   */
  static restore(programs: Programs | ((colony: ColonySave) => Programs | null), saved: WorldSave, options: Pick<WorldOptions, 'haltOnError'> = {}): World {
    const save = structuredClone(saved); // the world mutates what it holds; never share it with the caller's copy
    const w = new World(null, save.seed, { tick: save.tick, haltOnError: options.haltOnError, maps: save.maps, hedges: save.hedges });
    Object.assign(w, {
      persistent: save.persistent, flowers: save.flowers, nextId: save.nextId, nextColonyId: save.nextColonyId,
      nextNestId: save.nextNestId ?? 1, nestsToRegrow: save.nestsToRegrow ?? 0,
    });
    w.rng = mulberry32(save.rng);
    for (const n of save.nests ?? []) w.nests.push({ ...n, wasps: n.wasps.map(b => ({ ...b, runner: new Runner([], {}) })) });
    for (const cs of save.colonies) {
      const p = typeof programs === 'function' ? programs(cs) : programs;
      if (!p) continue;
      const c = new Colony(w, cs.id, cs.map, p, cs.owner, cs.hive);
      Object.assign(c, {
        honey: cs.honey, totalHoney: cs.totalHoney, deaths: cs.deaths, comb: cs.comb, logCount: cs.logCount, emptyFor: cs.emptyFor, over: cs.over,
        foundedAt: cs.foundedAt ?? 0, stolen: cs.stolen ?? 0, kills: cs.kills ?? 0, nest: cs.nest ?? null,
        shielded: cs.shielded ?? false, shieldEnds: cs.shieldEnds ?? null,
      });
      for (const [key, marks] of cs.scents) c.scents.set(key, new Map(marks));
      c.eggs.push(...cs.eggs);
      c.log.push(...cs.log);
      c.queen = cs.queen && { runner: queenRunner(c, p), action: null, laid: cs.queen.laid };
      for (const body of cs.bees) {
        // saves from before health existed: every bee at full health
        const maxHealth = body.maxHealth ?? (body.role === 'wasp' ? WASP_HEALTH : BEE_HEALTH);
        const bee = { ...body, maxHealth, health: body.health ?? maxHealth, action: null } as Bee;
        bee.runner = c.runnerFor(bee);
        c.bees.push(bee);
      }
      // fallen bees run nothing; they only keep their last state for the inspector
      for (const body of cs.fallen) c.fallen.push({ ...body, runner: new Runner([], {}) });
      w.colonies.push(c);
    }
    return w;
  }

  /** A new unit of a role at the colony's hive (eggs hatch through here). */
  spawn(colony: Colony, role = 'forager'): Bee {
    const lifespan = LIFESPAN_MIN + Math.floor(this.rng() * (LIFESPAN_MAX - LIFESPAN_MIN));
    const wasp = role === 'wasp';
    const health = wasp ? WASP_HEALTH : BEE_HEALTH;
    const at = wasp && colony.nest ? colony.nest : colony.hive; // wasps hatch at the colony's nest
    const bee = {
      id: this.nextId++, role, x: at.x, y: at.y, facing: 'south', carrying: 0, capacity: wasp ? WASP_CAPACITY : BEE_CAPACITY,
      energy: MAX_ENERGY, health, maxHealth: health, age: 0, lifespan, bornAt: this.tick, action: null, death: null,
      stats: { collected: 0, delivered: 0, tilesFlown: 0, honeyEaten: 0, built: 0, stolen: 0, stings: 0 },
    } as Body as Bee;
    bee.runner = colony.runnerFor(bee);
    colony.bees.push(bee);
    this.events.push({ type: 'hatch', x: at.x, y: at.y, id: bee.id });
    return bee;
  }

  // ---- the queen ----

  private stepQueen(colony: Colony): void {
    const q = colony.queen!;
    if (q.action && --q.action.left > 0) return;
    if (q.action?.kind === 'nest') q.runner.resume(this.buildNest(colony, q.action.target));
    q.action = null;
    if (q.runner.finished) return;
    const result = q.runner.run(OPS_PER_TICK);
    if (result.type === 'action') {
      if (result.action === 'nest') {
        q.action = { kind: 'nest', left: NEST_BUILD_TICKS, target: { x: result.args[0] as number, y: result.args[1] as number } };
      } else if (result.action === 'lay') {
        const role = (result.args[0] as string | undefined) ?? 'forager';
        const cost = role === 'wasp' ? WASP_COST : BEE_COST;
        if (role === 'wasp' && !colony.nest && !colony.waspNoteShown) {
          colony.waspNoteShown = true;
          colony.say('queen', `Wasps hatch at a wasp nest, and the colony has none. Save up ${NEST_COST} honey and build one with build_nest(position).`, 'note');
        }
        // a wasp egg needs the nest instead of a cell of comb
        const room = role === 'wasp' ? colony.nest !== null : colony.space > 0;
        const ok = room && colony.honey >= cost && colony.bees.length + colony.eggs.length < BEE_LIMIT;
        if (ok) {
          // a brand-new colony's first egg hatches at once, so a new game doesn't open with nothing moving
          const first = q.laid === 0 && colony.bees.length === 0 && colony.eggs.length === 0;
          colony.honey -= cost;
          colony.eggs.push({ role, laidAt: this.tick, hatchAt: this.tick + (first ? 1 : HATCH_TICKS) });
          q.laid++;
          this.events.push({ type: 'lay', x: colony.hive.x, y: colony.hive.y });
        }
        q.runner.resume(ok);
        q.action = { kind: 'lay', left: LAY_TICKS };
      } else {
        q.action = { kind: 'wait', left: result.args[0] as number };
      }
    } else if (result.type === 'error') {
      const at = locate('queen', result.error.line); // shared.bee runs ahead of queen.bee
      if (this.haltOnError) this.error = { message: result.error.message, line: at.line, file: at.file, beeId: null };
      colony.say('queen', `${at.file}.bee line ${at.line}: ${result.error.message}`, 'error');
    } else if (result.type === 'done') {
      colony.say('queen', 'Reached the end of her script and stopped. The colony will not grow.', 'note');
    }
  }

  /** The queen's nest-building finishing: the nest goes up if the colony can afford it and the tile is free. */
  private buildNest(colony: Colony, at: Tile): boolean {
    const free = !this.blocked(at) && !this.isHive(at) && !this.nestAt(at) && !this.colonyNestAt(at) && !this.flowerAt(at.x, at.y);
    if (colony.nest || colony.honey < NEST_COST || !free) return false;
    colony.honey -= NEST_COST;
    colony.nest = { x: at.x, y: at.y, health: NEST_HEALTH, maxHealth: NEST_HEALTH };
    colony.waspNoteShown = false;
    this.events.push({ type: 'build', x: at.x, y: at.y });
    colony.say('queen', `Built a wasp nest at [${at.x}, ${at.y}] for ${NEST_COST} honey. Now lay("wasp") raises wasps there.`, 'note');
    return true;
  }

  // ---- worker bees ----

  private stepBee(colony: Colony, bee: Bee): void {
    bee.age += this.season === 'winter' ? WINTER_AGING : 1;
    bee.energy = Math.max(0, bee.energy - this.drain(bee.action));
    if (bee.age >= bee.lifespan) return this.die(colony, bee, 'old age');
    if (bee.energy <= 0) return this.die(colony, bee, 'starved');

    if (bee.action) {
      if (!this.advance(colony, bee, bee.action)) return;
      bee.action = null;
    }
    if (bee.runner.finished) return;
    const result = bee.runner.run(OPS_PER_TICK);
    if (result.type === 'action') this.begin(colony, bee, result.action, result.args);
    else if (result.type === 'error') {
      const at = locate(bee.role, result.error.line);
      if (this.haltOnError) this.error = { message: result.error.message, line: at.line, file: at.file, beeId: bee.id };
      colony.say(bee, `${at.file}.bee line ${at.line}: ${result.error.message}`, 'error');
    } else if (result.type === 'done') colony.say(bee, 'Reached the end of the script and stopped.', 'note');
  }

  /**
   * Finds a way around a bee in the way: first the other L-shaped route (along y first
   * instead of x, or the reverse), then a sidestep to the right, as in keep-right traffic,
   * so two bees meeting head-on pass each other. If neither is free, the bee keeps waiting.
   */
  private steer(bee: Bee, a: MoveAction): void {
    const goingAlongX = a.path[0].x !== bee.x;
    const other = this.plan(bee, a.target, !goingAlongX);
    if (other.length && !this.taken(other[0], bee)) {
      a.path = other;
      return;
    }
    const dir = dirTowards(bee, a.path[0]);
    for (const side of [RIGHT_OF[dir], RIGHT_OF[RIGHT_OF[RIGHT_OF[dir]]]]) {
      const [dx, dy] = STEP[side];
      const step = { x: bee.x + dx, y: bee.y + dy };
      if (!this.blocked(step) && !this.taken(step, bee)) {
        a.path = [step, ...this.plan(step, a.target, goingAlongX)];
        return;
      }
    }
  }

  /** Energy a bee burns this tick, given what it is doing and the season. */
  private drain(action: Action | null): number {
    const winter = this.season === 'winter';
    switch (action?.kind) {
      case 'move': return (ENERGY_PER_TILE / MOVE_TICKS) * (winter ? WINTER_FLIGHT : 1);
      case 'collect': return ENERGY_PER_WORK / COLLECT_TICKS;
      case 'deposit': return ENERGY_PER_WORK / DEPOSIT_TICKS;
      case 'eat': return ENERGY_PER_WORK / EAT_TICKS;
      case 'build': return (ENERGY_PER_WORK * 4) / BUILD_TICKS;
      case 'mark': return ENERGY_PER_WORK / MARK_TICKS;
      case 'sting': return ENERGY_PER_WORK / STING_TICKS;
      case 'steal': return ENERGY_PER_WORK / STEAL_TICKS;
      default: return winter ? WINTER_IDLE : ENERGY_IDLE;
    }
  }

  private die(colony: Colony, bee: Bee, cause: DeathCause, by = ''): void {
    bee.death = { cause, tick: this.tick };
    bee.action = null;
    colony.bees.splice(colony.bees.indexOf(bee), 1);
    colony.fallen.push(bee);
    if (colony.fallen.length > FALLEN_LIMIT) colony.fallen.shift();
    colony.deaths++;
    this.events.push({ type: 'death', id: bee.id, role: bee.role, x: bee.x, y: bee.y, facing: bee.facing, cause });
    const where = `[${bee.x}, ${bee.y}]`;
    const lost = bee.carrying ? ` carrying ${bee.carrying} nectar` : '';
    colony.say(
      bee,
      cause === 'starved'
        ? `Starved at ${where}: ran out of energy${lost}.`
        : cause === 'stung'
          ? `Stung to death at ${where} by ${by}${lost}.`
        : cause === 'by choice'
          ? `Gave its life at ${where}${lost}, freeing its cell of comb.`
        : cause === 'last sting'
          ? `Stung ${by} and died doing it: a bee stings only once. Its sting did ${BEE_STING_DAMAGE} damage${lost ? `, and it was${lost}` : ''}.`
          : `Died of old age at ${where}, ${(this.tick - bee.bornAt).toLocaleString('en-US')} ticks after hatching.`,
      'death',
    );
  }

  /** Starts an action the script asked for. Arguments were already checked by the built-in. */
  private begin(colony: Colony, bee: Bee, action: string, args: Value[]): void {
    switch (action) {
      case 'move': {
        const dir = args[0] as Dir;
        bee.facing = dir;
        const [dx, dy] = STEP[dir];
        const next = { x: bee.x + dx, y: bee.y + dy };
        if (this.blocked(next) || this.taken(next, bee)) {
          bee.action = { kind: 'bump', left: BUMP_TICKS };
          bee.runner.resume(false);
          return;
        }
        bee.action = { kind: 'move', path: [next], target: next, stepLeft: 0, moving: false, waited: 0, single: true };
        this.claim(bee, bee.action);
        return;
      }
      case 'move_to': {
        const target = { x: args[0] as number, y: args[1] as number };
        const path = this.blocked(target) ? [] : this.plan(bee, target);
        if (!path.length) {
          bee.runner.resume(bee.x === target.x && bee.y === target.y); // already there, or no way in
          return;
        }
        bee.facing = dirTowards(bee, path[0]);
        bee.action = { kind: 'move', path, target, stepLeft: 0, moving: false, waited: 0, single: false };
        this.claim(bee, bee.action);
        return;
      }
      case 'collect':
        bee.action = { kind: 'collect', left: COLLECT_TICKS };
        return;
      case 'deposit':
        bee.action = { kind: 'deposit', left: DEPOSIT_TICKS };
        return;
      case 'eat':
        bee.action = { kind: 'eat', left: EAT_TICKS };
        return;
      case 'build':
        bee.action = { kind: 'build', left: BUILD_TICKS };
        return;
      case 'mark':
        bee.action = { kind: 'mark', left: MARK_TICKS, scent: args[0] as string };
        return;
      case 'die':
        this.die(colony, bee, 'by choice');
        return;
      case 'sting': {
        const target = { x: args[0] as number, y: args[1] as number };
        if (target.x !== bee.x) bee.facing = target.x > bee.x ? 'east' : 'west';
        bee.action = { kind: 'sting', left: STING_TICKS, target };
        return;
      }
      case 'steal':
        bee.action = { kind: 'steal', left: STEAL_TICKS };
        return;
      case 'wait':
        bee.action = { kind: 'wait', left: args[0] as number };
        return;
      default:
        throw new Error(`Unknown action "${action}"`);
    }
  }

  /**
   * Claims the next tile on a move's path and starts flying into it, if no other bee has it.
   * Called the moment a move starts or a tile is reached, so a bee with a clear way never
   * spends a tick standing still between tiles.
   */
  private claim(bee: Bee, a: MoveAction): boolean {
    if (this.taken(a.path[0], bee)) return false;
    a.moving = true;
    a.stepLeft = MOVE_TICKS;
    bee.facing = dirTowards(bee, a.path[0]);
    return true;
  }

  /** One tick of a move: still going, arrived, or given up (blocked too long, or a single step into a taken tile). */
  private moveTick(bee: Bee, a: MoveAction): 'going' | 'arrived' | 'failed' {
    if (!a.moving) {
      // still waiting for the next tile to be free
      if (this.claim(bee, a)) return 'going';
      if (a.single) return 'failed';
      // steer around a bee on the way; if it is sitting on the destination itself, just wait
      if (a.path.length > 1 && a.waited % 6 === 0) this.steer(bee, a);
      return ++a.waited > MAX_BLOCKED_TICKS ? 'failed' : 'going';
    }
    if (--a.stepLeft > 0) return 'going';
    const next = a.path.shift()!;
    bee.x = next.x;
    bee.y = next.y;
    bee.stats.tilesFlown++;
    a.moving = false;
    if (a.path.length) {
      // fly straight on into the next tile, so the bee never stops mid-route
      this.claim(bee, a);
      return 'going';
    }
    return 'arrived';
  }

  /** Advances an action by one tick. Returns true when it has finished. */
  private advance(colony: Colony, bee: Bee, a: Action): boolean {
    if (a.kind === 'move') {
      const r = this.moveTick(bee, a);
      if (r === 'going') return false;
      bee.runner.resume(r === 'arrived');
      return true;
    }
    if (--a.left > 0) return false;
    switch (a.kind) {
      case 'collect': {
        const f = this.flowerAt(bee.x, bee.y);
        const ok = f !== null && f.nectar > 0 && bee.carrying < bee.capacity;
        if (ok) {
          f.nectar--;
          bee.carrying++;
          bee.stats.collected++;
          this.events.push({ type: 'collect', x: bee.x, y: bee.y });
        }
        bee.runner.resume(ok);
        break;
      }
      case 'deposit': {
        const amount = colony.atHive(bee) ? bee.carrying : 0;
        if (amount) {
          colony.honey += amount;
          colony.totalHoney += amount;
          bee.carrying = 0;
          bee.stats.delivered += amount;
          this.events.push({ type: 'deposit', x: bee.x, y: bee.y, amount });
        }
        bee.runner.resume(amount);
        break;
      }
      case 'eat': {
        // whole honey only, rounded to the nearest; a nearly full bee eats nothing rather than wasting a honey.
        // A hurt bee eats until it's healed, too.
        const forEnergy = Math.round((MAX_ENERGY - bee.energy) / ENERGY_PER_HONEY);
        const forHealth = Math.ceil((bee.maxHealth - bee.health) / HEALTH_PER_HONEY);
        const eaten = colony.atHive(bee) ? Math.min(Math.max(forEnergy, forHealth), colony.honey) : 0;
        colony.honey -= eaten;
        bee.energy = Math.min(MAX_ENERGY, bee.energy + eaten * ENERGY_PER_HONEY);
        bee.health = Math.min(bee.maxHealth, bee.health + eaten * HEALTH_PER_HONEY);
        bee.stats.honeyEaten += eaten;
        bee.runner.resume(eaten);
        break;
      }
      case 'build': {
        const ok = colony.atHive(bee) && colony.honey >= BUILD_COST && colony.comb < COMB_LIMIT;
        if (ok) {
          colony.honey -= BUILD_COST;
          colony.comb++;
          bee.stats.built++;
          this.events.push({ type: 'build', x: colony.hive.x, y: colony.hive.y });
          colony.say(bee, `Built a new cell of comb (${colony.comb} cells).`, 'note');
        }
        bee.runner.resume(ok);
        break;
      }
      case 'mark':
        markScent(colony, bee, a.scent, this.tick);
        bee.runner.resume(true);
        break;
      case 'sting': {
        const hit = this.strike(bee, colony, a.target);
        if (hit && bee.role !== 'wasp') {
          // a worker bee's sting is its last: it leaves the alarm scent where it fell, and dies
          markScent(colony, bee, 'danger', this.tick);
          this.die(colony, bee, 'last sting', hit);
          return false;
        }
        bee.runner.resume(!!hit);
        break;
      }
      case 'steal':
        bee.runner.resume(this.steal(colony, bee));
        break;
      // wait and bump just pass time
    }
    return true;
  }

  // ---- raids and fights ----

  /** Honey taken from another colony's hive the bee is at, as much as it can carry; 0 anywhere else. */
  private steal(colony: Colony, bee: Bee): number {
    const victim = this.colonies.find(c => c !== colony && c.atHive(bee));
    const amount = victim && !victim.shielded ? Math.min(bee.capacity - bee.carrying, victim.honey) : 0;
    if (!victim || amount <= 0) return 0;
    this.endShield(colony, victim);
    victim.honey -= amount;
    bee.carrying += amount;
    bee.stats.stolen = (bee.stats.stolen ?? 0) + amount;
    colony.stolen += amount;
    this.events.push({ type: 'steal', x: bee.x, y: bee.y, amount });
    victim.say(null, `Raided: ${colony.name}'s ${bee.role} #${bee.id} stole ${amount} honey from the hive.`, 'raid');
    colony.say(bee, `Stole ${amount} honey from ${victim.name}'s hive.`, 'raid');
    return amount;
  }

  /**
   * A sting landing on a tile next to the attacker. It hurts one enemy there (wasps first),
   * or, from a player's wasp, the nest on that tile. Wild wasps (from = null) never sting into a hive.
   * Returns whether it hit.
   */
  /**
   * A sting on a tile next to the attacker: the first enemy unit there, or (from a player's wasp)
   * an enemy nest. Says what it hit, or null when it missed. Wasps do STING_DAMAGE; a worker
   * bee does BEE_STING_DAMAGE, only to units, and the caller ends its life.
   */
  private strike(attacker: Bee, from: Colony | null, target: Tile): string | null {
    if (Math.abs(target.x - attacker.x) + Math.abs(target.y - attacker.y) > 1) return null; // the target flew off
    const wasp = attacker.role === 'wasp';
    const damage = wasp ? STING_DAMAGE : BEE_STING_DAMAGE;
    const victims: { unit: Bee; colony: Colony | null; nest: Nest | null }[] = [];
    const at = (b: Bee) => b.x === target.x && b.y === target.y;
    if (from || !this.isHive(target)) {
      for (const c of this.colonies) if (c !== from && !c.shielded) for (const b of c.bees) if (at(b)) victims.push({ unit: b, colony: c, nest: null });
    }
    if (from) for (const n of this.nests) for (const w of n.wasps) if (at(w)) victims.push({ unit: w, colony: null, nest: n });
    victims.sort((a, b) => Number(b.unit.role === 'wasp') - Number(a.unit.role === 'wasp') || a.unit.id - b.unit.id);
    const v = victims[0];
    if (v) {
      if (from && v.colony) this.endShield(from, v.colony);
      attacker.stats.stings = (attacker.stats.stings ?? 0) + 1;
      this.hurt(v.unit, v.colony, v.nest, attacker, from, damage);
      return v.colony ? `${v.colony.name}'s ${v.unit.role === 'wasp' ? 'wasp' : 'bee'} #${v.unit.id}` : 'a wild wasp';
    }
    if (!wasp) return null; // nests are a wasp's job
    const owned = from && this.colonyNestAt(target);
    if (owned && owned !== from && !owned.shielded) {
      this.endShield(from, owned);
      const n = owned.nest!;
      attacker.stats.stings = (attacker.stats.stings ?? 0) + 1;
      n.health -= STING_DAMAGE;
      this.events.push({ type: 'hit', id: 0, x: n.x, y: n.y });
      if (n.health <= 0) {
        owned.nest = null;
        this.events.push({ type: 'nest', x: n.x, y: n.y });
        from.kills++;
        from.say(attacker, `Destroyed ${owned.name}'s wasp nest at [${n.x}, ${n.y}].`, 'raid');
        owned.say(null, `${from.name}'s wasp #${attacker.id} destroyed our wasp nest at [${n.x}, ${n.y}]. Our wasps live on, but the queen can't lay more until we build a new nest.`, 'raid');
      }
      return `${owned.name}'s wasp nest`;
    }
    const nest = from && this.nestAt(target);
    if (!nest) return null;
    attacker.stats.stings = (attacker.stats.stings ?? 0) + 1;
    nest.health -= STING_DAMAGE;
    this.events.push({ type: 'hit', id: 0, x: nest.x, y: nest.y });
    if (nest.health <= 0) {
      this.nests.splice(this.nests.indexOf(nest), 1);
      this.nestsToRegrow++;
      for (const w of nest.wasps) this.events.push({ type: 'death', id: w.id, role: 'wasp', x: w.x, y: w.y, facing: w.facing, cause: 'stung' });
      this.events.push({ type: 'nest', x: nest.x, y: nest.y });
      from!.kills++;
      from!.say(attacker, `Destroyed the wild wasp nest at [${nest.x}, ${nest.y}]. Another will hang somewhere next spring.`, 'raid');
    }
    return 'the wild wasp nest';
  }

  /** A protected colony that attacks another player gives up its protection. */
  private endShield(attacker: Colony, victim: Colony): void {
    if (!attacker.shielded) return;
    attacker.shielded = false;
    attacker.shieldEnds = null;
    attacker.say(null, `Our colony attacked ${victim.name}, so its protection as a new colony has ended. Others can raid and sting us now.`, 'raid');
  }

  private hurt(unit: Bee, colony: Colony | null, nest: Nest | null, attacker: Bee, from: Colony | null, damage: number): void {
    unit.health -= damage;
    this.events.push({ type: 'hit', id: unit.id, x: unit.x, y: unit.y });
    if (unit.health > 0) return;
    const by = from ? `${from.name}'s ${attacker.role === 'wasp' ? 'wasp' : 'bee'} #${attacker.id}` : 'a wild wasp';
    if (colony) {
      this.die(colony, unit, 'stung', by);
      const visit = from ? null : this.nests.find(n => n.visitor && n.wasps.includes(attacker));
      if (visit?.visitor) {
        // a visitor eats what it caught, and after a few has had its fill
        attacker.action = { kind: 'wait', left: VISITOR_REST };
        visit.visitor.lastKill = this.tick + VISITOR_REST;
        if (++visit.visitor.kills >= VISITOR_KILLS) this.sendOff(visit);
      }
    } else if (nest) {
      nest.wasps.splice(nest.wasps.indexOf(unit), 1);
      if (nest.visitor && !nest.wasps.length) this.nests.splice(this.nests.indexOf(nest), 1); // the visitor is gone
      delete nest.roam[unit.id];
      this.events.push({ type: 'death', id: unit.id, role: 'wasp', x: unit.x, y: unit.y, facing: unit.facing, cause: 'stung' });
    }
    if (from) {
      from.kills++;
      from.say(attacker, `Stung ${colony ? `${colony.name}'s ${unit.role} #${unit.id}` : 'a wild wasp'} to death.`, 'raid');
    }
  }

  // ---- wild wasps ----

  /** Hangs a nest on a random map with no colony and no nest; false when there is none. */
  private hangNest(): boolean {
    const free: Tile[] = [];
    for (let y = 0; y < this.maps[1]; y++) for (let x = 0; x < this.maps[0]; x++) if (!this.colonyOn({ x, y }) && !this.nestOn({ x, y })) free.push({ x, y });
    if (!free.length) return false;
    const map = free[Math.floor(this.rng() * free.length)];
    this.addNest({ x: map.x * COLS + NEST_SPOT.x, y: map.y * ROWS + NEST_SPOT.y }, NEST_WASPS);
    return true;
  }

  /** Hangs a wild wasp nest on a tile, with some wild wasps already in it. */
  addNest(at: Tile, wasps: number): void {
    const nest: Nest = { id: this.nextNestId++, x: at.x, y: at.y, health: NEST_HEALTH, maxHealth: NEST_HEALTH, wasps: [], spawnIn: NEST_SPAWN_TICKS, roam: {} };
    this.nests.push(nest);
    for (let i = 0; i < wasps; i++) this.spawnWild(nest);
  }

  private spawnWild(nest: Nest): void {
    nest.wasps.push({
      id: this.nextId++, role: 'wasp', x: nest.x, y: nest.y, facing: 'west', carrying: 0, capacity: 0,
      energy: MAX_ENERGY, health: WASP_HEALTH, maxHealth: WASP_HEALTH, age: 0, lifespan: 1e9, bornAt: this.tick, action: null, death: null,
      stats: { collected: 0, delivered: 0, tilesFlown: 0, honeyEaten: 0, built: 0, stolen: 0, stings: 0 },
      runner: new Runner([], {}),
    });
  }

  private stepNest(nest: Nest): void {
    if (nest.visitor) {
      // bees that keep out of reach wear it out: no kill for a while and it gives up
      if (this.tick - nest.visitor.lastKill > VISITOR_PATIENCE) this.sendOff(nest);
      for (const w of [...nest.wasps]) this.stepWild(nest, w);
      return;
    }
    if (nest.wasps.length < NEST_WASPS && this.season !== 'winter' && --nest.spawnIn <= 0) {
      this.spawnWild(nest);
      nest.spawnIn = NEST_SPAWN_TICKS;
    }
    for (const w of [...nest.wasps]) this.stepWild(nest, w);
  }

  /**
   * A wild wasp's mind: finish what it's doing, then sting an enemy next to it, chase one it
   * can see (not too far from the nest, and never into a hive), or wander near the nest.
   * In winter it stays in the nest. It needs no food and never grows old.
   */
  private stepWild(nest: Nest, w: Bee): void {
    const a = w.action;
    if (a) {
      if (a.kind === 'move') {
        if (this.moveTick(w, a) === 'going') return;
      } else {
        if (--a.left > 0) return;
        if (a.kind === 'sting') this.strike(w, null, a.target);
      }
      if (w.action === a) w.action = null;
      if (w.action) return; // a visitor resting after a kill
    }
    const home = { x: nest.x, y: nest.y };
    if (nest.visitor?.leaving) {
      // its season is over: off the meadow by the nearest edge
      if (w.x === home.x && w.y === home.y) this.removeVisitor(nest, 'The wild wasp flew off.');
      else this.stepToward(w, home);
      return;
    }
    if (this.season === 'winter') {
      if (w.x !== home.x || w.y !== home.y) this.stepToward(w, home);
      else w.action = { kind: 'wait', left: 60 };
      return;
    }
    // a wild wasp guards its nest's own map: it hunts nobody beyond it, and never a protected colony's bees
    const nestMap = this.mapAt(nest);
    const leashed = (t: Tile) => { const m = this.mapAt(t); return m.x === nestMap.x && m.y === nestMap.y; };
    let prey: Bee | null = null;
    let best = Infinity;
    for (const c of this.colonies) {
      if (c.shielded) continue;
      for (const b of c.bees) {
        const d = Math.hypot(b.x - w.x, b.y - w.y);
        if (d <= SENSE_RANGE && d < best && leashed(b) && !this.isHive(b)) {
          prey = b;
          best = d;
        }
      }
    }
    if (prey) {
      if (Math.abs(prey.x - w.x) + Math.abs(prey.y - w.y) === 1) {
        if (prey.x !== w.x) w.facing = prey.x > w.x ? 'east' : 'west';
        w.action = { kind: 'sting', left: STING_TICKS, target: { x: prey.x, y: prey.y } };
      } else this.stepToward(w, prey);
      return;
    }
    // nobody to sting: roam to a spot near the nest, then rest a while
    let spot = nest.roam[w.id];
    if (!spot || (spot.x === w.x && spot.y === w.y)) {
      if (spot) {
        delete nest.roam[w.id];
        w.action = { kind: 'wait', left: 20 + Math.floor(this.rng() * 40) };
        return;
      }
      const x0 = nestMap.x * COLS;
      const y0 = nestMap.y * ROWS;
      const wander = nest.visitor ? COLS : WILD_WANDER; // a visitor roams the whole meadow
      const x = Math.max(x0, Math.min(x0 + COLS - 1, nest.x + Math.floor(this.rng() * (wander * 2 + 1)) - wander));
      const y = Math.max(y0, Math.min(y0 + ROWS - 1, nest.y + Math.floor(this.rng() * (wander * 2 + 1)) - wander));
      if (this.blocked({ x, y })) {
        w.action = { kind: 'wait', left: BUMP_TICKS }; // a spot in the hedge: pick again soon
        return;
      }
      spot = nest.roam[w.id] = { x, y };
    }
    if (!this.stepToward(w, spot)) delete nest.roam[w.id]; // blocked: pick somewhere else next time
  }

  /**
   * Single player, as a season starts: a visitor still here flies off, and in a season with flowers
   * (never the first spring, which isn't a season change) a new one may arrive at the meadow's edge.
   */
  private visitorsAtSeason(season: Season): void {
    for (const n of this.nests) if (n.visitor) this.sendOff(n);
    if (season === 'winter' || this.nests.some(n => n.visitor) || this.rng() >= VISITOR_CHANCE) return;
    const colony = this.colonies[0];
    if (!colony) return;
    const x0 = colony.map.x * COLS;
    const y0 = colony.map.y * ROWS;
    const sides: [string, () => Tile][] = [
      ['east', () => ({ x: x0 + COLS - 1, y: y0 + Math.floor(this.rng() * ROWS) })],
      ['west', () => ({ x: x0, y: y0 + Math.floor(this.rng() * ROWS) })],
      ['north', () => ({ x: x0 + Math.floor(this.rng() * COLS), y: y0 })],
      ['south', () => ({ x: x0 + Math.floor(this.rng() * COLS), y: y0 + ROWS - 1 })],
    ];
    const [side, pick] = sides[Math.floor(this.rng() * sides.length)];
    let at: Tile | null = null;
    for (let tries = 0; tries < 10 && !at; tries++) {
      const t = pick();
      if (!this.blocked(t) && !this.taken(t) && !this.isHive(t)) at = t;
    }
    if (!at) return;
    // its anchor is the middle of the meadow, so it roams all of it
    const nest: Nest = {
      id: this.nextNestId++, x: x0 + (COLS >> 1), y: y0 + (ROWS >> 1), health: NEST_HEALTH, maxHealth: NEST_HEALTH,
      wasps: [], spawnIn: 0, roam: {}, visitor: { leaving: false, kills: 0, lastKill: this.tick },
    };
    this.spawnWild(nest);
    [nest.wasps[0].x, nest.wasps[0].y] = [at.x, at.y];
    this.nests.push(nest);
    for (const c of this.colonies) if (c.running) c.say(null, `A wild wasp flew onto the meadow from the ${side}. It stings bees out in the open; the hive is safe.`, 'season');
  }

  /** A visitor heads for the nearest edge of its map, and leaves once it's there. */
  private sendOff(n: Nest): void {
    const w = n.wasps[0];
    if (!n.visitor || n.visitor.leaving || !w) return;
    const map = this.mapAt(w);
    const x0 = map.x * COLS;
    const y0 = map.y * ROWS;
    const ways: Tile[] = [{ x: x0, y: w.y }, { x: x0 + COLS - 1, y: w.y }, { x: w.x, y: y0 }, { x: w.x, y: y0 + ROWS - 1 }];
    const out = ways.reduce((a, b) => (Math.abs(b.x - w.x) + Math.abs(b.y - w.y) < Math.abs(a.x - w.x) + Math.abs(a.y - w.y) ? b : a));
    n.visitor.leaving = true;
    n.x = out.x;
    n.y = out.y;
    delete n.roam[w.id];
  }

  /** A visitor leaves the meadow (or the world), with a note in every colony's log. */
  private removeVisitor(nest: Nest, note: string): void {
    const i = this.nests.indexOf(nest);
    if (i >= 0) this.nests.splice(i, 1);
    for (const c of this.colonies) if (c.running) c.say(null, note, 'season');
  }

  /** One tile toward a target, along whichever way is free; waits a moment when both are blocked. */
  private stepToward(w: Bee, t: Tile): boolean {
    const dx = Math.sign(t.x - w.x);
    const dy = Math.sign(t.y - w.y);
    const xs = { x: w.x + dx, y: w.y };
    const ys = { x: w.x, y: w.y + dy };
    const options = Math.abs(t.x - w.x) >= Math.abs(t.y - w.y) ? [dx ? xs : null, dy ? ys : null] : [dy ? ys : null, dx ? xs : null];
    if (this.hedges.size) options.unshift(this.plan(w, t)[0] ?? null); // the way around a hedge comes first
    for (const next of options) {
      if (!next || this.blocked(next) || this.taken(next, w) || this.isHive(next)) continue; // wild wasps keep out of hives
      const a: MoveAction = { kind: 'move', path: [next], target: next, stepLeft: 0, moving: false, waited: 0, single: true };
      w.action = a;
      this.claim(w, a);
      return true;
    }
    w.action = { kind: 'wait', left: BUMP_TICKS };
    return false;
  }
}

/** Forgets marks that have faded completely. */
function fadeScents(colony: Colony): void {
  for (const [key, marks] of colony.scents) {
    for (const [name, at] of marks) if (scentStrength(colony.tick, at) === 0) marks.delete(name);
    if (!marks.size) colony.scents.delete(key);
  }
}

function checkSurvival(colony: Colony): void {
  if (colony.bees.length || colony.eggs.length) {
    colony.emptyFor = 0;
    return;
  }
  colony.emptyFor++;
  if (colony.honey < BEE_COST) colony.over = 'The colony died out: no bees or eggs are left, and there is not enough honey for another egg.';
  else if (colony.emptyFor >= EMPTY_HIVE_TICKS) colony.over = 'The colony died out: no bees or eggs were left, and the queen did not lay.';
  if (colony.over) colony.say(null, colony.over, 'death');
}

/**
 * Hedgerows for a world of maps: every map's left column and top row, and the world's last column
 * and row, so one hedge runs along each border and around the whole world. Each border between two
 * maps has one gate, two tiles wide, placed by the seed and kept away from the corners.
 */
export function hedgeLayout(seed: number, maps: [number, number]): { hedges: Set<number>; gates: Tile[] } {
  const [mx, my] = maps;
  const W = mx * COLS;
  const H = my * ROWS;
  const hedges = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < mx; c++) hedges.add(tileKey(c * COLS, y));
    hedges.add(tileKey(W - 1, y));
  }
  for (let x = 0; x < W; x++) {
    for (let r = 0; r < my; r++) hedges.add(tileKey(x, r * ROWS));
    hedges.add(tileKey(x, H - 1));
  }
  // where along a border its gate starts: at least 2 tiles from each corner
  const gateAt = (c: number, r: number, down: boolean, span: number) => {
    const rnd = mulberry32((Math.imul(seed, 0x45d9f3b) + Math.imul(c + 1, 0x27d4eb2d) + Math.imul(r + 1, 0x165667b1) + (down ? 0x9e3779b1 : 0)) >>> 0);
    return 2 + Math.floor(rnd() * (span - 5));
  };
  const gates: Tile[] = [];
  const open = (x: number, y: number) => {
    hedges.delete(tileKey(x, y));
    gates.push({ x, y });
  };
  for (let r = 0; r < my; r++) {
    for (let c = 0; c < mx; c++) {
      if (c > 0) {
        const g = r * ROWS + gateAt(c, r, true, ROWS); // the border between map [c - 1, r] and [c, r]
        open(c * COLS, g);
        open(c * COLS, g + 1);
      }
      if (r > 0) {
        const g = c * COLS + gateAt(c, r, false, COLS); // the border between map [c, r - 1] and [c, r]
        open(g, r * ROWS);
        open(g + 1, r * ROWS);
      }
    }
  }
  return { hedges, gates };
}

/** Free cells of comb: every bee and egg takes one, except wasps, which live in the colony's nest. */
export function combFree(comb: number, bees: { role: string }[], eggs: { role: string }[]): number {
  const inComb = (u: { role: string }) => u.role !== 'wasp';
  return comb - bees.filter(inComb).length - eggs.filter(inComb).length;
}

// Season and scent arithmetic, shared by World and by views of a world that runs elsewhere.
export const seasonAt = (tick: number): Season => SEASONS[Math.floor(tick / SEASON_TICKS) % SEASONS.length];
export const yearAt = (tick: number): number => Math.floor(tick / (SEASON_TICKS * SEASONS.length)) + 1;
export const seasonLeftAt = (tick: number): number => SEASON_TICKS - (tick % SEASON_TICKS);
/** How strong a scent marked at markedAt is at tick: SCENT_MAX when fresh, fading evenly to 0. */
export const scentStrength = (tick: number, markedAt: number): number =>
  Math.max(0, Math.ceil(SCENT_MAX * (1 - (tick - markedAt) / SCENT_LIFE)));

/** What hiveProblem needs to know about the land. */
export interface HiveLand {
  flowerAt(x: number, y: number): boolean;
  hedgeAt(x: number, y: number): boolean;
  nestAt(tile: Tile): boolean;
}

/**
 * Why a colony's hive can't go on a tile (world positions) of a map, or null when it can: its
 * footprint must be on that map, clear of flowers and nests, and the hive tile can't be a hedge.
 * A gate right next to it is fine.
 */
export function hiveProblem(map: Tile, hive: Tile, land: HiveLand): string | null {
  const x0 = map.x * COLS;
  const y0 = map.y * ROWS;
  if (hive.x < x0 || hive.y < y0 || hive.x >= x0 + COLS || hive.y >= y0 + ROWS) return `it isn't on map [${map.x}, ${map.y}].`;
  if (land.hedgeAt(hive.x, hive.y)) return "it's a hedge.";
  if (hive.x - 1 < x0 || hive.x + 1 >= x0 + COLS || hive.y - 3 < y0 || hive.y + 1 >= y0 + ROWS) return "the hive doesn't fit this close to the edge of the map.";
  if (land.flowerAt(hive.x, hive.y)) return 'a flower grows there.';
  for (let y = hive.y - 3; y <= hive.y + 1; y++) {
    for (let x = hive.x - 1; x <= hive.x + 1; x++) {
      if (land.flowerAt(x, y)) return 'flowers would be under the hive.';
      if (land.nestAt({ x, y })) return 'a wasp nest is in the way.';
    }
  }
  return null;
}

/**
 * One map's flowers for a season, in world positions. Each map grows its own patches around
 * its HIVE_SPOT, claimed or not, except under hives placed elsewhere (world positions); map
 * [0, 0] grows exactly single player's meadow for the seed.
 */
export function bloomMap(seed: number, map: Tile, year: number, season: Season, hives: Tile[] = []): Flower[] {
  if (season === 'winter') return [];
  const mapSeed = map.x === 0 && map.y === 0 ? seed : (Math.imul(seed, 0x2c1b3c6d) + Math.imul(map.x + 1, 0x297a2d39) + Math.imul(map.y + 1, 0x1b873593)) >>> 0;
  return bloom(mapSeed, year, season, HIVE_SPOT)
    .map(f => ({ ...f, x: f.x + map.x * COLS, y: f.y + map.y * ROWS }))
    .filter(f => !hives.some(h => inFootprint(h, f.x, f.y)));
}

/**
 * The flowers that bloom on one map in a season: patches of that season's kind, placed from
 * the seed, year and season, in the map's own positions. The same seed always grows the same.
 */
export function bloom(seed: number, year: number, season: Exclude<Season, 'winter'>, hive: Tile): Flower[] {
  const b = BLOOMS[season];
  const rnd = mulberry32((Math.imul(seed, 0x9e3779b1) ^ Math.imul(year * 4 + SEASONS.indexOf(season), 0x85ebca6b)) >>> 0);
  const used = new Set<number>();
  // nothing grows on or right around the hive, nor under its boxes, which cover the tiles above it
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < COLS && y < ROWS && !used.has(y * COLS + x) &&
    !inFootprint(hive, x, y);
  const centers: Tile[] = [];
  const flowers: Flower[] = [];
  for (let p = 0; p < b.patches; p++) {
    let center: Tile | null = null;
    for (let tries = 0; tries < 200 && !center; tries++) {
      const x = Math.floor(rnd() * COLS);
      const y = Math.floor(rnd() * ROWS);
      const d = Math.hypot(x - hive.x, y - hive.y);
      // patches keep at least 3 tiles apart, so they read as separate patches
      if (d >= b.near && d <= b.far && free(x, y) && centers.every(c => Math.hypot(c.x - x, c.y - y) > 3)) center = { x, y };
    }
    if (!center) continue;
    centers.push(center);
    const size = b.size[0] + Math.floor(rnd() * (b.size[1] - b.size[0] + 1));
    const patch = [center];
    used.add(center.y * COLS + center.x);
    for (let tries = 0; patch.length < size && tries < 40; tries++) {
      const from = patch[Math.floor(rnd() * patch.length)];
      const [dx, dy] = STEP[DIRS[Math.floor(rnd() * DIRS.length)]];
      const t = { x: from.x + dx, y: from.y + dy };
      if (!free(t.x, t.y)) continue;
      patch.push(t);
      used.add(t.y * COLS + t.x);
    }
    for (const t of patch) flowers.push({ ...t, kind: b.kind, nectar: b.nectar, max: b.nectar, regen: 0, color: Math.floor(rnd() * 2) });
  }
  return flowers;
}

/** Leaves (or freshens) a colony's scent on a unit's tile. */
function markScent(colony: Colony, at: Tile, scent: string, tick: number): void {
  const key = tileKey(at.x, at.y);
  if (!colony.scents.has(key)) colony.scents.set(key, new Map());
  colony.scents.get(key)!.set(scent, tick);
}

/** The queen's runner: shared.bee first, so its constants and functions exist for her too, then queen.bee. */
function queenRunner(colony: Colony, programs: Programs): Runner {
  return new Runner([...(programs.shared ?? []), ...programs.queen], queenGlobals(colony));
}

const RIGHT_OF: Record<Dir, Dir> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/** An L-shaped path of tiles from one tile to another, not including the start. */
function route(from: Tile, to: Tile, xFirst: boolean): Tile[] {
  const path: Tile[] = [];
  let { x, y } = from;
  const alongX = () => { while (x !== to.x) path.push({ x: (x += Math.sign(to.x - x)), y }); };
  const alongY = () => { while (y !== to.y) path.push({ x, y: (y += Math.sign(to.y - y)) }); };
  if (xFirst) { alongX(); alongY(); } else { alongY(); alongX(); }
  return path;
}

function dirTowards(from: Tile, to: Tile): Dir {
  if (to.x > from.x) return 'east';
  if (to.x < from.x) return 'west';
  return to.y > from.y ? 'south' : 'north';
}
