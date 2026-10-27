import type { Value } from '../lang/interpreter';
import {
  COLS, combFree, ROWS, scentStrength, seasonAt, seasonLeftAt, tileKey, yearAt,
  type Bee, type Colony, type ColonyNest, type Egg, type Flower, type LogLine, type Queen, type Season, type Tile, type World, type WorldEvent,
} from './world';

// A colony as the screen sees it, on the map being watched. The renderer, the stat cards and the
// HUD read only this, so they draw a local colony (single player) and one on the server alike.

export interface RunnerView {
  line: number;
  finished: boolean;
  error: { message: string; line: number } | null;
  variables(): [string, Value][];
}
export type BeeView = Omit<Bee, 'runner'> & { runner: RunnerView };
/** Another player's bee: what anyone watching can see, without anything about its script. */
export type VisitorView = Omit<Bee, 'runner'> & { owner: string | null };
export interface QueenView {
  runner: RunnerView;
  action: Queen['action'];
  laid: number;
}
export interface HiveView extends Tile {
  owner: string | null;
}
export interface NestView extends Tile {
  health: number;
  maxHealth: number;
  owner: string | null; // a colony's nest: its player (null in single player)
  wild: boolean;
}

export interface ColonyView {
  readonly tick: number;
  readonly season: Season;
  readonly year: number;
  readonly seasonLeft: number;
  readonly honey: number;
  readonly comb: number;
  readonly space: number;
  readonly deaths: number;
  /** This colony's hive; null while watching the world without a colony. */
  readonly hive: Tile | null;
  /** This colony's wasp nest, if it has built one. */
  readonly nest: ColonyNest | null;
  /** The top-left tile of the map on screen. */
  readonly origin: Tile;
  /** Flowers on the map on screen. */
  readonly flowers: Flower[];
  /** This colony's bees, wherever they are. */
  readonly bees: BeeView[];
  /** Other colonies' bees, and wild wasps (owner null), on the map on screen. */
  readonly visitors: VisitorView[];
  /** Wasp nests on the map on screen: wild ones, and colonies' own. */
  readonly nests: NestView[];
  /** Other colonies' hives on the map on screen. */
  readonly otherHives: HiveView[];
  readonly eggs: Egg[];
  readonly queen: QueenView | null;
  readonly log: LogLine[];
  readonly roleNames: string[];
  readonly scents: Map<number, Map<string, number>>;
  readonly over: string | null;
  /** What happened since the renderer last looked; it clears them. */
  events: WorldEvent[];
  findBee(id: number | null): BeeView | null;
  flowerAt(x: number, y: number): Flower | null;
  atHive(tile: Tile): boolean;
  scentsAt(x: number, y: number): [string, number][];
}

// ---- over the wire ----

type RunnerJson = { line: number; finished: boolean; error: { message: string; line: number } | null; variables: [string, Value][] };
type BeeJson = Omit<Bee, 'runner'> & { runner: RunnerJson };

/** One player's colony as plain JSON. */
export interface OwnColonyJson {
  honey: number;
  comb: number;
  deaths: number;
  hive: Tile;
  nest: ColonyNest | null;
  bees: BeeJson[];
  fallen: BeeJson[];
  eggs: Egg[];
  queen: { runner: RunnerJson; action: Queen['action']; laid: number } | null;
  log: LogLine[]; // the latest lines; a viewer keeps the ones whose seq it hasn't seen
  roleNames: string[];
  scents: [number, [string, number][]][];
  over: string | null;
}

/** What a player sees after every server tick: the map they watch, and their own colony if they have one. */
export interface ColonyJson {
  tick: number;
  map: Tile;
  flowers: Flower[];
  visitors: VisitorView[];
  otherHives: HiveView[];
  nests: NestView[];
  events: WorldEvent[];
  colony: OwnColonyJson | null;
}

const runnerJson = (r: Bee['runner']): RunnerJson => ({
  line: r.line,
  finished: r.finished,
  error: r.error && { message: r.error.message, line: r.error.line },
  variables: r.variables(),
});
const beeJson = ({ runner, ...body }: Bee): BeeJson => ({ ...body, runner: runnerJson(runner) });

/** Whether a tile is on a map or just past its edge (a bee flying across the border). */
export function onMap(map: Tile, t: Tile): boolean {
  const x = t.x - map.x * COLS;
  const y = t.y - map.y * ROWS;
  return x >= -1 && y >= -1 && x <= COLS && y <= ROWS;
}

/** What a viewer needs after one tick: a map of the world, and their colony (if any) with logTail lines of log. */
export function toJson(world: World, colony: Colony | null, map: Tile, logTail = 60): ColonyJson {
  const visitors: VisitorView[] = [];
  const otherHives: HiveView[] = [];
  for (const c of world.colonies) {
    if (c === colony) continue;
    if (c.map.x === map.x && c.map.y === map.y) otherHives.push({ ...c.hive, owner: c.owner });
    for (const { runner: _runner, ...body } of c.bees) if (onMap(map, body)) visitors.push({ ...body, owner: c.owner });
  }
  const nests: NestView[] = [];
  for (const c of world.colonies) if (c.nest && onMap(map, c.nest)) nests.push({ ...c.nest, owner: c.owner, wild: false });
  for (const n of world.nests) {
    if (onMap(map, n)) nests.push({ x: n.x, y: n.y, health: n.health, maxHealth: n.maxHealth, owner: null, wild: true });
    for (const { runner: _runner, ...w } of n.wasps) if (onMap(map, w)) visitors.push({ ...w, owner: null });
  }
  return {
    tick: world.tick,
    map,
    flowers: world.flowers.filter(f => onMap(map, f)),
    visitors,
    otherHives,
    nests,
    events: world.events.filter(e => onMap(map, e)),
    colony: colony && {
      honey: colony.honey,
      comb: colony.comb,
      deaths: colony.deaths,
      hive: colony.hive,
      nest: colony.nest,
      bees: colony.bees.map(beeJson),
      fallen: colony.fallen.slice(-10).map(beeJson),
      eggs: colony.eggs,
      queen: colony.queen && { runner: runnerJson(colony.queen.runner), action: colony.queen.action, laid: colony.queen.laid },
      log: colony.log.slice(-logTail),
      roleNames: colony.roleNames,
      scents: [...colony.scents].map(([key, marks]) => [key, [...marks]]),
      over: colony.over,
    },
  };
}

const runnerView = (r: RunnerJson): RunnerView => ({ ...r, variables: () => r.variables });
const beeView = ({ runner, ...body }: BeeJson): BeeView => ({ ...body, runner: runnerView(runner) });

/**
 * A colony that runs somewhere else, rebuilt from the latest ColonyJson. update() takes each
 * new tick; the log keeps growing across ticks, so a viewer never misses a line.
 */
export class RemoteColony implements ColonyView {
  tick = 0;
  honey = 0;
  comb = 0;
  deaths = 0;
  hive: Tile | null = null;
  nest: ColonyNest | null = null;
  map: Tile = { x: 0, y: 0 };
  flowers: Flower[] = [];
  bees: BeeView[] = [];
  visitors: VisitorView[] = [];
  otherHives: HiveView[] = [];
  nests: NestView[] = [];
  fallen: BeeView[] = [];
  eggs: Egg[] = [];
  queen: QueenView | null = null;
  log: LogLine[] = [];
  roleNames: string[] = ['forager'];
  scents = new Map<number, Map<string, number>>();
  over: string | null = null;
  events: WorldEvent[] = [];
  private flowerIndex = new Map<number, Flower>();

  constructor(private readonly logLimit = 500) {}

  update(json: ColonyJson): void {
    Object.assign(this, { tick: json.tick, map: json.map, flowers: json.flowers, visitors: json.visitors, otherHives: json.otherHives, nests: json.nests });
    this.flowerIndex = new Map(json.flowers.map(f => [tileKey(f.x, f.y), f]));
    this.events.push(...json.events);
    const c = json.colony;
    if (!c) {
      Object.assign(this, { honey: 0, comb: 0, deaths: 0, hive: null, nest: null, bees: [], fallen: [], eggs: [], queen: null, roleNames: ['forager'], over: null });
      this.scents = new Map();
      return;
    }
    Object.assign(this, { honey: c.honey, comb: c.comb, deaths: c.deaths, hive: c.hive, nest: c.nest ?? null, eggs: c.eggs, roleNames: c.roleNames, over: c.over });
    this.bees = c.bees.map(beeView);
    this.fallen = c.fallen.map(beeView);
    this.queen = c.queen && { runner: runnerView(c.queen.runner), action: c.queen.action, laid: c.queen.laid };
    this.scents = new Map(c.scents.map(([key, marks]) => [key, new Map(marks)]));
    const last = this.log.at(-1)?.seq ?? -1;
    this.log.push(...c.log.filter(l => l.seq > last));
    if (this.log.length > this.logLimit) this.log.splice(0, this.log.length - this.logLimit);
  }

  get origin(): Tile {
    return { x: this.map.x * COLS, y: this.map.y * ROWS };
  }
  get season(): Season {
    return seasonAt(this.tick);
  }
  get year(): number {
    return yearAt(this.tick);
  }
  get seasonLeft(): number {
    return seasonLeftAt(this.tick);
  }
  get space(): number {
    return combFree(this.comb, this.bees, this.eggs);
  }
  findBee(id: number | null): BeeView | null {
    if (id === null) return null;
    return this.bees.find(b => b.id === id) ?? this.fallen.find(b => b.id === id) ?? null;
  }
  flowerAt(x: number, y: number): Flower | null {
    return this.flowerIndex.get(tileKey(x, y)) ?? null;
  }
  atHive(tile: Tile): boolean {
    return !!this.hive && tile.x === this.hive.x && tile.y === this.hive.y;
  }
  scentsAt(x: number, y: number): [string, number][] {
    const marks = this.scents.get(tileKey(x, y));
    if (!marks) return [];
    return [...marks]
      .map(([name, at]): [string, number] => [name, scentStrength(this.tick, at)])
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1]);
  }
}
