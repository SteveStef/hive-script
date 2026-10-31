import { builtin, coreBuiltins, expectArgs } from '../lang/builtins';
import { ScriptError } from '../lang/errors';
import { format, isCallable, type ActionRequest, type Named, type Value } from '../lang/interpreter';
import { BUILD_MAX, COLS, DIRS, eggCost, MAX_WAIT, NEST_COST, ROWS, SCENT_NAME_MAX, statDefault, STATS, type Bee, type Build, type Colony } from './world';

const act = (action: string, args: Value[] = []): ActionRequest => ({ action, args });

/** A role name a script passed in: it must be text, and one of the colony's roles. */
function roleName(colony: Colony, name: string, v: Value, line: number): string {
  if (typeof v !== 'string') throw new ScriptError(`${name}() needs a role's name as text, like "forager", not ${format(v, true)}.`, line);
  if (!colony.roleNames.includes(v)) throw new ScriptError(`There's no role called "${v}". Your roles: ${colony.roleNames.join(', ')}.`, line);
  return v;
}

/** The named values lay() and egg_cost() take: the role, and the stats to raise (read late: world.ts imports this file too). */
const eggNames = () => ['type', ...STATS];

/**
 * The egg a lay() or egg_cost() call asks for: a role, given plainly or as type=, and any stats
 * raised above the role's default, up to BUILD_MAX times it, like lay(type="wasp", energy=300).
 */
function eggOrder(colony: Colony, name: string, args: Value[], named: Named, line: number): { role: string; build: Build } {
  if (args.length > 1) throw new ScriptError(`${name}() takes a role's name (or nothing, for a forager) and stats like energy=300, but got ${args.length} plain values.`, line);
  if (args.length && 'type' in named) throw new ScriptError(`${name}() got the role twice: give it once, as "wasp" or as type="wasp".`, line);
  const which = args.length ? args[0] : named.type;
  const role = which === undefined ? 'forager' : roleName(colony, name, which, line);
  const build: Build = {};
  for (const stat of STATS) {
    const v = named[stat];
    if (v === undefined) continue;
    const low = statDefault(role, stat);
    const high = low * BUILD_MAX;
    if (low === 0) throw new ScriptError(`A ${role} carries nothing, so ${stat}= is for bees only.`, line);
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new ScriptError(`${stat}= needs a whole number: from ${low} to ${high} for a ${role}.`, line);
    if (v < low || v > high) throw new ScriptError(`A ${role}'s ${stat} can be from ${low} (its default) up to ${high}, not ${v}.`, line);
    if (v > low) build[stat] = v;
  }
  return { role, build };
}

/** A position a script passed in: two whole numbers, inside the world. */
function position(colony: Colony, name: string, v: Value, line: number): [number, number] {
  if (Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1])) {
    const [x, y] = v as number[];
    if (!colony.world.inside(x, y)) throw new ScriptError(`[${x}, ${y}] is outside the meadow.`, line);
    return [x, y];
  }
  throw new ScriptError(`${name}() needs a position like [3, 5], not ${format(v, true)}.`, line);
}

/** A hive board entry's name: text, up to the same length as a scent's name. */
function boardName(name: string, v: Value, line: number): string {
  if (typeof v === 'string' && v.length >= 1 && v.length <= SCENT_NAME_MAX) return v;
  throw new ScriptError(`${name}() needs the entry's name as text, like "flowers" (up to ${SCENT_NAME_MAX} letters), not ${format(v, true)}.`, line);
}

/** tell(name, value), for the queen and workers alike. Whether it fits is checked when it lands, as a False. */
const tell = builtin('tell', (args, line) => {
  expectArgs('tell', args, 2, line);
  const name = boardName('tell', args[0], line);
  const plain = (v: Value): boolean => !isCallable(v) && (!Array.isArray(v) || v.every(plain));
  if (!plain(args[1])) throw new ScriptError("tell() can share numbers, text, True/False, None and lists of them, but not a function.", line);
  return act('tell', [name, args[1]]);
});

/** Senses about the whole colony, plus wait(); both the queen and the workers get these. */
function colonyGlobals(colony: Colony): Record<string, Value> {
  const world = colony.world;
  return {
    honey: builtin('honey', () => colony.honey),
    bee_count: builtin('bee_count', () => colony.bees.length),
    egg_count: builtin('egg_count', () => colony.eggs.length),
    comb: builtin('comb', () => colony.comb),
    space: builtin('space', () => colony.space),
    season: builtin('season', () => world.season),
    season_left: builtin('season_left', () => world.seasonLeft),
    year: builtin('year', () => world.year),
    roles: builtin('roles', (args, line) => {
      expectArgs('roles', args, 0, line);
      return colony.roleNames;
    }),
    egg_cost: builtin('egg_cost', (args, line, named) => {
      const { role, build } = eggOrder(colony, 'egg_cost', args, named, line);
      return eggCost(role, build);
    }, eggNames()),
    role_count: builtin('role_count', (args, line) => {
      expectArgs('role_count', args, 1, line);
      const role = roleName(colony, 'role_count', args[0], line);
      return colony.bees.filter(b => b.role === role).length;
    }),
    // distance() counts the way a bee really flies: around hedges, through their gates
    distance: builtin('distance', (args, line) => {
      expectArgs('distance', args, 2, line);
      const [a, b] = args.map(v => {
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return v as number[];
        throw new ScriptError(`distance() needs two positions like [3, 5], not ${format(v, true)}.`, line);
      });
      const tile = (p: number[]) => Number.isInteger(p[0]) && Number.isInteger(p[1]) && world.inside(p[0], p[1]);
      if (tile(a) && tile(b)) return world.travel({ x: a[0], y: a[1] }, { x: b[0], y: b[1] });
      return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    }),
    blocked: builtin('blocked', (args, line) => {
      expectArgs('blocked', args, 1, line);
      const v = args[0];
      if (!(Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]))) {
        throw new ScriptError(`blocked() needs a position like [3, 5], not ${format(v, true)}.`, line);
      }
      return world.blocked({ x: v[0] as number, y: v[1] as number });
    }),
    shielded: builtin('shielded', (args, line) => {
      expectArgs('shielded', args, 1, line);
      const [x, y] = position(colony, 'shielded', args[0], line);
      return world.shieldedAt({ x, y });
    }),
    nest_pos: builtin('nest_pos', (args, line) => {
      expectArgs('nest_pos', args, 0, line);
      return colony.nest ? [colony.nest.x, colony.nest.y] : null;
    }),
    my_map: builtin('my_map', (args, line) => {
      expectArgs('my_map', args, 0, line);
      return [colony.map.x, colony.map.y];
    }),
    owner_at: builtin('owner_at', (args, line) => {
      expectArgs('owner_at', args, 1, line);
      const [x, y] = position(colony, 'owner_at', args[0], line);
      return world.ownerAt({ x, y });
    }),
    map_at: builtin('map_at', (args, line) => {
      expectArgs('map_at', args, 1, line);
      const [x, y] = position(colony, 'map_at', args[0], line);
      const m = world.mapAt({ x, y });
      return [m.x, m.y];
    }),
    wait: builtin('wait', (args, line) => {
      expectArgs('wait', args, 1, line);
      const n = args[0];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_WAIT) {
        throw new ScriptError(`wait(ticks) needs a whole number from 1 to ${MAX_WAIT}.`, line);
      }
      return act('wait', [n]);
    }),
    random: builtin('random', (args, line) => {
      expectArgs('random', args, 1, line);
      const n = args[0];
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new ScriptError('random(n) needs a whole number of at least 1.', line);
      return Math.floor(world.rng() * n);
    }),
  };
}

/** Everything a worker bee's script (forager.bee) can see. */
export function beeGlobals(colony: Colony, bee: Bee): Record<string, Value> {
  const world = colony.world;
  const scentName = (name: string, v: Value, line: number): string => {
    if (typeof v === 'string' && v.length >= 1 && v.length <= SCENT_NAME_MAX) return v;
    throw new ScriptError(`${name}() needs the scent's name as text, like "food" (up to ${SCENT_NAME_MAX} letters), not ${format(v, true)}.`, line);
  };
  const wasp = bee.role === 'wasp';
  const action = (name: string, run: string = name) =>
    builtin(name, (args, line) => {
      expectArgs(name, args, 0, line);
      return act(run);
    });
  // bee work a wasp can't do, with an explanation instead of a quiet False
  const beeWork = (name: string, why: string) =>
    wasp
      ? builtin(name, (_args, line) => {
          throw new ScriptError(`Wasps can't ${why}; that's work for bees. Wasps sting() and guard.`, line);
        })
      : action(name);

  return {
    ...coreBuiltins(text => colony.say(bee, text)),
    ...colonyGlobals(colony),

    North: 'north',
    South: 'south',
    East: 'east',
    West: 'west',

    // actions: these take game time
    move: builtin('move', (args, line) => {
      expectArgs('move', args, 1, line);
      if (!DIRS.includes(args[0] as never)) throw new ScriptError('move() needs a direction: North, South, East or West.', line);
      return act('move', [args[0]]);
    }),
    move_to: builtin('move_to', (args, line) => {
      expectArgs('move_to', args, 1, line);
      return act('move_to', position(colony, 'move_to', args[0], line));
    }),
    go_home: builtin('go_home', (args, line) => {
      expectArgs('go_home', args, 0, line);
      // a wasp's home is its colony's nest, once there is one
      const home = bee.role === 'wasp' && colony.nest ? colony.nest : colony.hive;
      return act('move_to', [home.x, home.y]);
    }),
    collect: beeWork('collect', 'collect nectar'),
    deposit: action('deposit'),
    eat: action('eat'),
    build: beeWork('build', 'build comb'),
    die: action('die'),
    build_nest: builtin('build_nest', (_args, line) => {
      throw new ScriptError(`The queen builds the wasp nest, from queen.bee: build_nest(position), for ${NEST_COST} honey.`, line);
    }),
    steal: beeWork('steal', 'carry honey, so they can\'t steal()'),
    sting: builtin('sting', (args, line) => {
      expectArgs('sting', args, 1, line);
      const [x, y] = position(colony, 'sting', args[0], line);
      if (Math.abs(x - bee.x) + Math.abs(y - bee.y) !== 1) {
        throw new ScriptError(`sting() reaches only a tile right next to the ${wasp ? 'wasp' : 'bee'}, and [${x}, ${y}] isn't next to [${bee.x}, ${bee.y}].`, line);
      }
      return act('sting', [x, y]);
    }),
    mark: builtin('mark', (args, line) => {
      expectArgs('mark', args, 1, line);
      return act('mark', [scentName('mark', args[0], line)]);
    }),
    unmark: builtin('unmark', (args, line) => {
      expectArgs('unmark', args, 1, line);
      return act('unmark', [scentName('unmark', args[0], line)]);
    }),

    // senses about this bee: these answer instantly
    gates: builtin('gates', (args, line) => {
      expectArgs('gates', args, 0, line);
      return world.gatesOf(colony.map, bee).map(t => [t.x, t.y]);
    }),
    random_spot: builtin('random_spot', (args, line) => {
      expectArgs('random_spot', args, 0, line);
      // an open tile on the colony's own map, for exploring
      const x0 = colony.map.x * COLS;
      const y0 = colony.map.y * ROWS;
      for (let i = 0; i < 20; i++) {
        const t = { x: x0 + Math.floor(world.rng() * COLS), y: y0 + Math.floor(world.rng() * ROWS) };
        if (!world.blocked(t)) return [t.x, t.y];
      }
      return [colony.hive.x, colony.hive.y];
    }),
    role: builtin('role', () => bee.role),
    get_pos: builtin('get_pos', () => [bee.x, bee.y]),
    hive_pos: builtin('hive_pos', () => [colony.hive.x, colony.hive.y]),
    nectar: builtin('nectar', () => bee.carrying),
    capacity: builtin('capacity', () => bee.capacity),
    at_hive: builtin('at_hive', () => colony.atHome(bee)),
    energy: builtin('energy', () => Math.floor(bee.energy)),
    max_energy: builtin('max_energy', () => bee.maxEnergy),
    damage: builtin('damage', () => bee.damage),
    health: builtin('health', () => bee.health),
    max_health: builtin('max_health', () => bee.maxHealth),
    enemies_near: builtin('enemies_near', (args, line) => {
      expectArgs('enemies_near', args, 0, line);
      return world.enemiesNear(colony, bee).map(b => [b.x, b.y]);
    }),
    age: builtin('age', () => bee.age),
    life_left: builtin('life_left', () => bee.lifespan - bee.age),
    flower_here: builtin('flower_here', () => (world.flowerAt(bee.x, bee.y)?.nectar ?? 0) > 0),
    nearest_flower: builtin('nearest_flower', () => {
      const f = world.nearestFlower(bee);
      return f ? [f.x, f.y] : null;
    }),
    flowers_near: builtin('flowers_near', (args, line) => {
      if (args.length > 1) throw new ScriptError(`flowers_near() takes nothing, or True to include empty flowers, but got ${args.length} values.`, line);
      if (args.length && typeof args[0] !== 'boolean') throw new ScriptError(`flowers_near() takes True or False (include empty flowers?), not ${format(args[0], true)}.`, line);
      return world.flowersNear(bee, args[0] === true).map(f => [f.x, f.y]);
    }),
    nectar_at: builtin('nectar_at', (args, line) => {
      expectArgs('nectar_at', args, 1, line);
      const [x, y] = position(colony, 'nectar_at', args[0], line);
      return world.nectarAt(bee, { x, y });
    }),
    smell: builtin('smell', (args, line) => {
      expectArgs('smell', args, 1, line);
      const t = colony.strongestScent(bee, scentName('smell', args[0], line));
      return t ? [t.x, t.y] : null;
    }),
    tell,
    recall: builtin('recall', (args, line) => {
      expectArgs('recall', args, 1, line);
      const name = boardName('recall', args[0], line);
      return colony.atHome(bee) ? colony.board.get(name) ?? null : null; // news is only heard at home
    }),
    smell_here: builtin('smell_here', (args, line) => {
      expectArgs('smell_here', args, 1, line);
      return colony.scentAt(bee.x, bee.y, scentName('smell_here', args[0], line));
    }),
  };
}

// Worker actions the queen might reach for; each gets a clear explanation instead of "not defined".
const WORKER_ONLY = ['move', 'move_to', 'go_home', 'collect', 'deposit', 'eat', 'build', 'mark', 'unmark', 'die', 'role', 'steal', 'sting', 'health', 'max_health', 'damage', 'enemies_near', 'flowers_near', 'nectar_at'];

/** Everything the queen's script (queen.bee) can see. */
export function queenGlobals(colony: Colony): Record<string, Value> {
  const globals: Record<string, Value> = {
    ...coreBuiltins(text => colony.say('queen', text)),
    ...colonyGlobals(colony),
    build_nest: builtin('build_nest', (args, line) => {
      expectArgs('build_nest', args, 1, line);
      const [x, y] = position(colony, 'build_nest', args[0], line);
      const m = colony.map;
      if (Math.floor(x / COLS) !== m.x || Math.floor(y / ROWS) !== m.y) {
        const [x0, y0] = [m.x * COLS, m.y * ROWS];
        throw new ScriptError(`The nest has to be on your own map: x from ${x0} to ${x0 + COLS - 1}, y from ${y0} to ${y0 + ROWS - 1}.`, line);
      }
      return act('nest', [x, y]);
    }),
    gates: builtin('gates', (args, line) => {
      expectArgs('gates', args, 0, line);
      return colony.world.gatesOf(colony.map, colony.hive).map(t => [t.x, t.y]);
    }),
    tell,
    recall: builtin('recall', (args, line) => {
      expectArgs('recall', args, 1, line);
      return colony.board.get(boardName('recall', args[0], line)) ?? null;
    }),
    lay: builtin('lay', (args, line, named) => {
      const { role, build } = eggOrder(colony, 'lay', args, named, line);
      const raised = Object.entries(build);
      return act('lay', raised.length ? [role, raised] : [role]);
    }, eggNames()),
  };
  for (const name of WORKER_ONLY) {
    globals[name] = builtin(name, (_args, line) => {
      throw new ScriptError(`The queen never leaves the hive or works; ${name}() is for worker bees. In shared.bee, keep it inside a function only bees call.`, line);
    });
  }
  // what a bee could ask that has an answer for the queen too, so shared.bee's top lines work for her
  const hive = () => [colony.hive.x, colony.hive.y];
  globals.hive_pos = builtin('hive_pos', hive);
  globals.get_pos = builtin('get_pos', hive);
  globals.at_hive = builtin('at_hive', () => true);
  globals.role = builtin('role', () => 'queen');
  return globals;
}
