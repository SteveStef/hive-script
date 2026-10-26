import type { Stmt } from '../lang/ast';
import { Runner, type Value } from '../lang/interpreter';
import { beeGlobals, queenGlobals } from './api';
import { mulberry32 } from './rng';

// ---- tuning ----

export const COLS = 20;
export const ROWS = 12;
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
export const MARK_TICKS = 4;

// scent
export const SCENT_LIFE = 900; // ticks a mark lasts (1 minute at 1x); it fades evenly to nothing
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
  spring: { kind: 'clover', patches: 4, size: [3, 4], near: 2, far: 7, nectar: 3 }, // small patches close to home
  summer: { kind: 'lavender', patches: 7, size: [3, 5], near: 2, far: 18, nectar: 3 }, // all over the meadow
  autumn: { kind: 'goldenrod', patches: 3, size: [4, 5], near: 7, far: 18, nectar: 5 }, // few, far out, but rich
};

// the colony
export const START_BEES = 1;
export const START_COMB = 10; // cells; every bee and every egg needs one
export const COMB_LIMIT = 120;
export const BEE_LIMIT = 120; // a safety ceiling for performance; comb is the real limit
export const BEE_COST = 10; // honey per egg
export const MAX_ROLES = 5; // custom roles, on top of forager
export const ROLE_NAME = /^[a-z][a-z0-9_]{0,11}$/; // lowercase, up to 12 characters
export const RESERVED_NAMES = ['forager', 'queen', 'shared']; // file names a custom role can't take
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

// seasons
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
export const SEASON_TICKS = 2700; // 3 minutes at 1x; a year is four seasons
/** Ticks for a flower to regrow one nectar; nothing grows in winter. */
export const REGEN_TICKS: Record<Season, number> = { spring: 240, summer: 160, autumn: 360, winter: Infinity };
export const WINTER_IDLE = 0.06; // keeping warm burns energy even at rest
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
  | { kind: 'collect' | 'deposit' | 'eat' | 'build' | 'wait' | 'bump'; left: number }
  | { kind: 'mark'; left: number; scent: string };

export type DeathCause = 'old age' | 'starved' | 'by choice';

export interface BeeStats {
  collected: number; // nectar picked up
  delivered: number; // honey made at the hive
  tilesFlown: number;
  honeyEaten: number;
  built: number; // cells of comb
}

export interface Bee extends Tile {
  id: number;
  role: string; // fixed for life
  facing: Dir;
  carrying: number;
  capacity: number;
  energy: number;
  age: number; // ticks lived; grows at half speed in winter
  lifespan: number; // ticks it will live, if it doesn't starve first
  bornAt: number; // tick it hatched
  action: Action | null;
  runner: Runner;
  stats: BeeStats;
  death: { cause: DeathCause; tick: number } | null;
}

/** The queen never leaves the hive and never dies; her script decides when to lay. */
export interface Queen {
  runner: Runner;
  action: { kind: 'lay' | 'wait'; left: number } | null;
  laid: number;
}

export interface Egg {
  role: string;
  laidAt: number;
  hatchAt: number;
}

export type WorldEvent =
  | { type: 'collect'; x: number; y: number }
  | { type: 'deposit'; amount: number }
  | { type: 'lay' }
  | { type: 'hatch'; id: number }
  | { type: 'build' }
  | { type: 'death'; id: number; x: number; y: number; facing: Dir; cause: DeathCause };

export interface LogLine {
  tick: number;
  who: number | 'queen' | null; // a bee id, the queen, or the colony itself
  text: string;
  tone?: 'error' | 'death' | 'season' | 'note'; // no tone: something a script printed
}

/** Optional starting state, used by the docs' example clips and by tests. */
export interface WorldOptions {
  bees?: number;
  honey?: number;
  tick?: number; // start partway through the year, e.g. late autumn
  energy?: number; // starting energy for the first bees
  comb?: number;
  /** A fixed meadow: these tiles bloom with each season's flower instead of seeded patches. */
  flowers?: [number, number][];
}

export interface WorldError {
  message: string;
  line: number;
  file: ScriptFile;
  beeId: number | null;
}

/**
 * The whole simulation. It only changes in step(), one tick at a time, and draws its
 * randomness from a seed, so the same scripts and seed always produce the same colony.
 */
export class World {
  tick = 0;
  honey = 0;
  totalHoney = 0;
  deaths = 0;
  comb = START_COMB;
  readonly hive: Tile = { x: 2, y: 6 };
  /** What is in bloom now; replaced each season, and empty in winter. */
  flowers: Flower[];
  readonly bees: Bee[] = [];
  readonly eggs: Egg[] = [];
  readonly queen: Queen | null = null;
  /** Bees that died recently, newest last, so the inspector can still show them. */
  readonly fallen: Bee[] = [];
  readonly log: LogLine[] = [];
  /** Things that happened since the renderer last looked; it clears them. */
  events: WorldEvent[] = [];
  error: WorldError | null = null;
  /** Set when the colony has died out. */
  over: string | null = null;
  /** Scent marks: tile key (y * COLS + x) -> scent name -> the tick it was last marked. */
  readonly scents = new Map<number, Map<string, number>>();
  readonly rng: () => number;
  private nextId = 1;
  private emptyFor = 0;
  private readonly fixedFlowers: [number, number][] | null;

  constructor(
    private readonly programs: Programs | null,
    readonly seed = 1,
    options: WorldOptions = {},
  ) {
    this.rng = mulberry32(seed);
    this.fixedFlowers = options.flowers ?? null;
    this.tick = options.tick ?? 0;
    this.honey = options.honey ?? 0;
    this.comb = options.comb ?? START_COMB;
    this.flowers = this.grow();
    if (!programs) return;
    this.queen = { runner: new Runner(programs.queen, queenGlobals(this)), action: null, laid: 0 };
    for (let i = 0; i < (options.bees ?? START_BEES); i++) this.spawn();
    if (options.energy !== undefined) for (const bee of this.bees) bee.energy = options.energy;
  }

  get running(): boolean {
    return this.programs !== null && this.error === null && this.over === null;
  }

  get season(): Season {
    return SEASONS[Math.floor(this.tick / SEASON_TICKS) % SEASONS.length];
  }

  get year(): number {
    return Math.floor(this.tick / (SEASON_TICKS * SEASONS.length)) + 1;
  }

  /** Ticks until the season changes. */
  get seasonLeft(): number {
    return SEASON_TICKS - (this.tick % SEASON_TICKS);
  }

  /** Free cells of comb: room for more eggs. */
  get space(): number {
    return this.comb - this.bees.length - this.eggs.length;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  flowerAt(x: number, y: number): Flower | null {
    return this.flowers.find(f => f.x === x && f.y === y) ?? null;
  }

  atHive(bee: Tile): boolean {
    return bee.x === this.hive.x && bee.y === this.hive.y;
  }

  /** A living or recently fallen bee. */
  findBee(id: number | null): Bee | null {
    if (id === null) return null;
    return this.bees.find(b => b.id === id) ?? this.fallen.find(b => b.id === id) ?? null;
  }

  /**
   * Whether another bee is on this tile or flying into it. Only one bee fits on a tile;
   * the hive is the exception, since every bee goes inside it.
   */
  taken(tile: Tile, by: Bee | null = null): boolean {
    if (this.atHive(tile)) return false;
    return this.bees.some(b => {
      if (b === by) return false;
      if (b.x === tile.x && b.y === tile.y) return true;
      const a = b.action;
      return a?.kind === 'move' && a.moving && a.path[0].x === tile.x && a.path[0].y === tile.y;
    });
  }

  /** The closest flower that still has nectar and no other bee on it, within the bee's sight. */
  nearestFlower(bee: Bee): Flower | null {
    let best: Flower | null = null;
    let bestDist = Infinity;
    for (const f of this.flowers) {
      if (f.nectar < 1 || this.taken(f, bee)) continue;
      const d = Math.hypot(f.x - bee.x, f.y - bee.y);
      if (d <= SENSE_RANGE && d < bestDist) {
        best = f;
        bestDist = d;
      }
    }
    return best;
  }

  /** How strong a scent is on a tile: SCENT_MAX when just marked, fading evenly to 0. */
  scentAt(x: number, y: number, name: string): number {
    const at = this.scents.get(y * COLS + x)?.get(name);
    return at === undefined ? 0 : this.strength(at);
  }

  /** Every scent on a tile with its strength, strongest first. */
  scentsAt(x: number, y: number): [string, number][] {
    const marks = this.scents.get(y * COLS + x);
    if (!marks) return [];
    return [...marks]
      .map(([name, at]): [string, number] => [name, this.strength(at)])
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
      const tile = { x: key % COLS, y: Math.floor(key / COLS) };
      const strength = this.strength(at);
      const d = Math.hypot(tile.x - bee.x, tile.y - bee.y);
      if (strength > 0 && d <= SMELL_RANGE && (strength > bestStrength || (strength === bestStrength && d < bestDist))) {
        best = tile;
        bestStrength = strength;
        bestDist = d;
      }
    }
    return best;
  }

  private strength(markedAt: number): number {
    return Math.max(0, Math.ceil(SCENT_MAX * (1 - (this.tick - markedAt) / SCENT_LIFE)));
  }

  say(who: Bee | 'queen' | null, text: string, tone?: LogLine['tone']): void {
    this.log.push({ tick: this.tick, who: who === 'queen' || who === null ? who : who.id, text, tone });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
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
    if (this.tick % 60 === 0) this.fadeScents();
    for (const bee of [...this.bees]) {
      this.stepBee(bee);
      if (this.error) return;
    }
    this.stepQueen();
    if (this.error) return;
    while (this.eggs.length && this.eggs[0].hatchAt <= this.tick) {
      const egg = this.eggs.shift()!;
      const bee = this.spawn(egg.role);
      this.say(bee, 'Hatched.', 'note');
    }
    this.checkSurvival();
  }

  /** Forgets marks that have faded completely. */
  private fadeScents(): void {
    for (const [key, marks] of this.scents) {
      for (const [name, at] of marks) if (this.strength(at) === 0) marks.delete(name);
      if (!marks.size) this.scents.delete(key);
    }
  }

  /** This season's flowers: the fixed meadow if there is one, otherwise seeded patches. */
  private grow(): Flower[] {
    const season = this.season;
    if (season === 'winter') return [];
    if (!this.fixedFlowers) return bloom(this.seed, this.year, season, this.hive);
    const b = BLOOMS[season];
    return this.fixedFlowers.map(([x, y]) => ({ x, y, kind: b.kind, nectar: b.nectar, max: b.nectar, regen: 0, color: (x + y) % 2 }));
  }

  private changeSeason(): void {
    this.flowers = this.grow();
    const s = this.season;
    if (s === 'spring') {
      this.say(null, `Spring, year ${this.year}: clover is blooming in small patches near the hive.`, 'season');
    } else if (s === 'summer') {
      this.say(null, 'Summer: the clover is over, and lavender blooms all across the meadow. Flowers regrow fastest now.', 'season');
    } else if (s === 'autumn') {
      this.say(null, 'Autumn: the last flowers, goldenrod, grow in a few rich patches far from the hive. Store honey for winter.', 'season');
    } else {
      this.say(null, 'Winter: the flowers are gone until spring, and keeping warm burns more energy.', 'season');
    }
  }

  private checkSurvival(): void {
    if (this.bees.length || this.eggs.length) {
      this.emptyFor = 0;
      return;
    }
    this.emptyFor++;
    if (this.honey < BEE_COST) this.over = 'The colony died out: no bees or eggs are left, and there is not enough honey for another egg.';
    else if (this.emptyFor >= EMPTY_HIVE_TICKS) this.over = 'The colony died out: no bees or eggs were left, and the queen did not lay.';
    if (this.over) this.say(null, this.over, 'death');
  }

  /** Every role's name, forager first. */
  get roleNames(): string[] {
    return ['forager', ...Object.keys(this.programs?.roles ?? {})];
  }

  private spawn(role = 'forager'): Bee {
    const lifespan = LIFESPAN_MIN + Math.floor(this.rng() * (LIFESPAN_MAX - LIFESPAN_MIN));
    const bee = {
      id: this.nextId++, role, x: this.hive.x, y: this.hive.y, facing: 'south', carrying: 0, capacity: 3,
      energy: MAX_ENERGY, age: 0, lifespan, bornAt: this.tick, action: null, death: null,
      stats: { collected: 0, delivered: 0, tilesFlown: 0, honeyEaten: 0, built: 0 },
    } as Omit<Bee, 'runner'> as Bee;
    const programs = this.programs!;
    const own = role === 'forager' ? programs.forager : programs.roles![role];
    // shared.bee runs first, so its functions are defined before the role's own code needs them
    bee.runner = new Runner([...(programs.shared ?? []), ...own], beeGlobals(this, bee));
    this.bees.push(bee);
    this.events.push({ type: 'hatch', id: bee.id });
    return bee;
  }

  // ---- the queen ----

  private stepQueen(): void {
    const q = this.queen!;
    if (q.action && --q.action.left > 0) return;
    q.action = null;
    if (q.runner.finished) return;
    const result = q.runner.run(OPS_PER_TICK);
    if (result.type === 'action') {
      if (result.action === 'lay') {
        const ok = this.honey >= BEE_COST && this.space > 0 && this.bees.length + this.eggs.length < BEE_LIMIT;
        if (ok) {
          this.honey -= BEE_COST;
          this.eggs.push({ role: (result.args[0] as string | undefined) ?? 'forager', laidAt: this.tick, hatchAt: this.tick + HATCH_TICKS });
          q.laid++;
          this.events.push({ type: 'lay' });
        }
        q.runner.resume(ok);
        q.action = { kind: 'lay', left: LAY_TICKS };
      } else {
        q.action = { kind: 'wait', left: result.args[0] as number };
      }
    } else if (result.type === 'error') {
      this.error = { message: result.error.message, line: result.error.line, file: 'queen', beeId: null };
      this.say('queen', `queen.bee line ${result.error.line}: ${result.error.message}`, 'error');
    } else if (result.type === 'done') {
      this.say('queen', 'Reached the end of her script and stopped. The colony will not grow.', 'note');
    }
  }

  // ---- worker bees ----

  private stepBee(bee: Bee): void {
    bee.age += this.season === 'winter' ? WINTER_AGING : 1;
    bee.energy = Math.max(0, bee.energy - this.drain(bee.action));
    if (bee.age >= bee.lifespan) return this.die(bee, 'old age');
    if (bee.energy <= 0) return this.die(bee, 'starved');

    if (bee.action) {
      if (!this.advance(bee, bee.action)) return;
      bee.action = null;
    }
    if (bee.runner.finished) return;
    const result = bee.runner.run(OPS_PER_TICK);
    if (result.type === 'action') this.begin(bee, result.action, result.args);
    else if (result.type === 'error') {
      const at = locate(bee.role, result.error.line);
      this.error = { message: result.error.message, line: at.line, file: at.file, beeId: bee.id };
      this.say(bee, `${at.file}.bee line ${at.line}: ${result.error.message}`, 'error');
    } else if (result.type === 'done') this.say(bee, 'Reached the end of the script and stopped.', 'note');
  }

  /**
   * Finds a way around a bee in the way: first the other L-shaped route (along y first
   * instead of x, or the reverse), then a sidestep to the right, as in keep-right traffic,
   * so two bees meeting head-on pass each other. If neither is free, the bee keeps waiting.
   */
  private steer(bee: Bee, a: Extract<Action, { kind: 'move' }>): void {
    const goingAlongX = a.path[0].x !== bee.x;
    const other = route(bee, a.target, !goingAlongX);
    if (other.length && !this.taken(other[0], bee)) {
      a.path = other;
      return;
    }
    const dir = dirTowards(bee, a.path[0]);
    for (const side of [RIGHT_OF[dir], RIGHT_OF[RIGHT_OF[RIGHT_OF[dir]]]]) {
      const [dx, dy] = STEP[side];
      const step = { x: bee.x + dx, y: bee.y + dy };
      if (this.inside(step.x, step.y) && !this.taken(step, bee)) {
        a.path = [step, ...route(step, a.target, goingAlongX)];
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
      default: return winter ? WINTER_IDLE : ENERGY_IDLE;
    }
  }

  private die(bee: Bee, cause: DeathCause): void {
    bee.death = { cause, tick: this.tick };
    bee.action = null;
    this.bees.splice(this.bees.indexOf(bee), 1);
    this.fallen.push(bee);
    if (this.fallen.length > FALLEN_LIMIT) this.fallen.shift();
    this.deaths++;
    this.events.push({ type: 'death', id: bee.id, x: bee.x, y: bee.y, facing: bee.facing, cause });
    const where = `[${bee.x}, ${bee.y}]`;
    const lost = bee.carrying ? ` carrying ${bee.carrying} nectar` : '';
    this.say(
      bee,
      cause === 'starved'
        ? `Starved at ${where}: ran out of energy${lost}.`
        : cause === 'by choice'
          ? `Gave its life at ${where}${lost}, freeing its cell of comb.`
          : `Died of old age at ${where}, ${(this.tick - bee.bornAt).toLocaleString('en-US')} ticks after hatching.`,
      'death',
    );
  }

  /** Starts an action the script asked for. Arguments were already checked by the built-in. */
  private begin(bee: Bee, action: string, args: Value[]): void {
    switch (action) {
      case 'move': {
        const dir = args[0] as Dir;
        bee.facing = dir;
        const [dx, dy] = STEP[dir];
        const next = { x: bee.x + dx, y: bee.y + dy };
        if (!this.inside(next.x, next.y) || this.taken(next, bee)) {
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
        const path = route(bee, target, true);
        if (!path.length) {
          bee.runner.resume(true);
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
        this.die(bee, 'by choice');
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
  private claim(bee: Bee, a: Extract<Action, { kind: 'move' }>): boolean {
    if (this.taken(a.path[0], bee)) return false;
    a.moving = true;
    a.stepLeft = MOVE_TICKS;
    bee.facing = dirTowards(bee, a.path[0]);
    return true;
  }

  /** Advances an action by one tick. Returns true when it has finished. */
  private advance(bee: Bee, a: Action): boolean {
    if (a.kind === 'move') {
      if (!a.moving) {
        // still waiting for the next tile to be free
        if (this.claim(bee, a)) return false;
        if (a.single) {
          bee.runner.resume(false);
          return true;
        }
        // steer around a bee on the way; if it is sitting on the destination itself, just wait
        if (a.path.length > 1 && a.waited % 6 === 0) this.steer(bee, a);
        if (++a.waited > MAX_BLOCKED_TICKS) {
          bee.runner.resume(false);
          return true;
        }
        return false;
      }
      if (--a.stepLeft > 0) return false;
      const next = a.path.shift()!;
      bee.x = next.x;
      bee.y = next.y;
      bee.stats.tilesFlown++;
      a.moving = false;
      if (a.path.length) {
        // fly straight on into the next tile, so the bee never stops mid-route
        this.claim(bee, a);
        return false;
      }
      bee.runner.resume(true);
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
        const amount = this.atHive(bee) ? bee.carrying : 0;
        if (amount) {
          this.honey += amount;
          this.totalHoney += amount;
          bee.carrying = 0;
          bee.stats.delivered += amount;
          this.events.push({ type: 'deposit', amount });
        }
        bee.runner.resume(amount);
        break;
      }
      case 'eat': {
        // whole honey only, rounded to the nearest; a nearly full bee eats nothing rather than wasting a honey
        const wanted = Math.round((MAX_ENERGY - bee.energy) / ENERGY_PER_HONEY);
        const eaten = this.atHive(bee) ? Math.min(wanted, this.honey) : 0;
        this.honey -= eaten;
        bee.energy = Math.min(MAX_ENERGY, bee.energy + eaten * ENERGY_PER_HONEY);
        bee.stats.honeyEaten += eaten;
        bee.runner.resume(eaten);
        break;
      }
      case 'build': {
        const ok = this.atHive(bee) && this.honey >= BUILD_COST && this.comb < COMB_LIMIT;
        if (ok) {
          this.honey -= BUILD_COST;
          this.comb++;
          bee.stats.built++;
          this.events.push({ type: 'build' });
          this.say(bee, `Built a new cell of comb (${this.comb} cells).`, 'note');
        }
        bee.runner.resume(ok);
        break;
      }
      case 'mark': {
        const key = bee.y * COLS + bee.x;
        if (!this.scents.has(key)) this.scents.set(key, new Map());
        this.scents.get(key)!.set(a.scent, this.tick);
        bee.runner.resume(true);
        break;
      }
      // wait and bump just pass time
    }
    return true;
  }
}

/**
 * The flowers that bloom in a season: patches of that season's kind, placed from the seed,
 * year and season. Every meadow differs, but the same seed always grows the same one.
 */
export function bloom(seed: number, year: number, season: Exclude<Season, 'winter'>, hive: Tile): Flower[] {
  const b = BLOOMS[season];
  const rnd = mulberry32((Math.imul(seed, 0x9e3779b1) ^ Math.imul(year * 4 + SEASONS.indexOf(season), 0x85ebca6b)) >>> 0);
  const used = new Set<number>();
  // nothing grows on or right around the hive, nor under the skep's dome, which covers the tiles above it
  const free = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < COLS && y < ROWS && !used.has(y * COLS + x) &&
    !(Math.abs(x - hive.x) <= 1 && y >= hive.y - 3 && y <= hive.y + 1);
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
