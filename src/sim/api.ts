import { builtin, coreBuiltins, expectArgs } from '../lang/builtins';
import { ScriptError } from '../lang/errors';
import { format, type ActionRequest, type Value } from '../lang/interpreter';
import { COLS, DIRS, MAX_ENERGY, MAX_WAIT, NEST_COST, ROWS, SCENT_NAME_MAX, type Bee, type Colony } from './world';

const act = (action: string, args: Value[] = []): ActionRequest => ({ action, args });

/** A role name a script passed in: it must be text, and one of the colony's roles. */
function roleName(colony: Colony, name: string, v: Value, line: number): string {
  if (typeof v !== 'string') throw new ScriptError(`${name}() needs a role's name as text, like "forager", not ${format(v, true)}.`, line);
  if (!colony.roleNames.includes(v)) throw new ScriptError(`There's no role called "${v}". Your roles: ${colony.roleNames.join(', ')}.`, line);
  return v;
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
    role_count: builtin('role_count', (args, line) => {
      expectArgs('role_count', args, 1, line);
      const role = roleName(colony, 'role_count', args[0], line);
      return colony.bees.filter(b => b.role === role).length;
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
          throw new ScriptError(`Wasps can't ${why}; that's work for bees. Wasps sting(), guard and steal().`, line);
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
      return act('move_to', [colony.hive.x, colony.hive.y]);
    }),
    collect: beeWork('collect', 'collect nectar'),
    deposit: action('deposit'),
    eat: action('eat'),
    build: beeWork('build', 'build comb'),
    die: action('die'),
    build_nest: builtin('build_nest', (_args, line) => {
      throw new ScriptError(`The queen builds the wasp nest, from queen.bee: build_nest(position), for ${NEST_COST} honey.`, line);
    }),
    steal: action('steal'),
    sting: builtin('sting', (args, line) => {
      expectArgs('sting', args, 1, line);
      if (!wasp) throw new ScriptError('Only wasps can sting. The queen lays them with lay("wasp"), and they run wasp.bee.', line);
      const [x, y] = position(colony, 'sting', args[0], line);
      if (Math.abs(x - bee.x) + Math.abs(y - bee.y) !== 1) {
        throw new ScriptError(`sting() reaches only a tile right next to the wasp, and [${x}, ${y}] isn't next to [${bee.x}, ${bee.y}].`, line);
      }
      return act('sting', [x, y]);
    }),
    mark: builtin('mark', (args, line) => {
      expectArgs('mark', args, 1, line);
      return act('mark', [scentName('mark', args[0], line)]);
    }),

    // senses about this bee: these answer instantly
    role: builtin('role', () => bee.role),
    get_pos: builtin('get_pos', () => [bee.x, bee.y]),
    hive_pos: builtin('hive_pos', () => [colony.hive.x, colony.hive.y]),
    nectar: builtin('nectar', () => bee.carrying),
    capacity: builtin('capacity', () => bee.capacity),
    at_hive: builtin('at_hive', () => colony.atHive(bee)),
    energy: builtin('energy', () => Math.floor(bee.energy)),
    max_energy: builtin('max_energy', () => MAX_ENERGY),
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
    smell: builtin('smell', (args, line) => {
      expectArgs('smell', args, 1, line);
      const t = colony.strongestScent(bee, scentName('smell', args[0], line));
      return t ? [t.x, t.y] : null;
    }),
    smell_here: builtin('smell_here', (args, line) => {
      expectArgs('smell_here', args, 1, line);
      return colony.scentAt(bee.x, bee.y, scentName('smell_here', args[0], line));
    }),
  };
}

// Worker actions the queen might reach for; each gets a clear explanation instead of "not defined".
const WORKER_ONLY = ['move', 'move_to', 'go_home', 'collect', 'deposit', 'eat', 'build', 'mark', 'die', 'role', 'steal', 'sting', 'health', 'max_health', 'enemies_near'];

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
    lay: builtin('lay', (args, line) => {
      if (args.length > 1) throw new ScriptError(`lay() takes a role's name, or nothing for a forager, but got ${args.length} values.`, line);
      return act('lay', args.length ? [roleName(colony, 'lay', args[0], line)] : []);
    }),
  };
  for (const name of WORKER_ONLY) {
    globals[name] = builtin(name, (_args, line) => {
      throw new ScriptError(`The queen never leaves the hive or works; ${name}() is for worker bees, in forager.bee or another role's script.`, line);
    });
  }
  return globals;
}
