import { builtin, coreBuiltins, expectArgs } from '../lang/builtins';
import { ScriptError } from '../lang/errors';
import { format, type ActionRequest, type Value } from '../lang/interpreter';
import { DIRS, MAX_ENERGY, MAX_WAIT, SCENT_NAME_MAX, type Bee, type World } from './world';

const act = (action: string, args: Value[] = []): ActionRequest => ({ action, args });

/** Senses about the whole colony, plus wait(); both the queen and the workers get these. */
function colonyGlobals(world: World): Record<string, Value> {
  return {
    honey: builtin('honey', () => world.honey),
    bee_count: builtin('bee_count', () => world.bees.length),
    egg_count: builtin('egg_count', () => world.eggs.length),
    comb: builtin('comb', () => world.comb),
    space: builtin('space', () => world.space),
    season: builtin('season', () => world.season),
    season_left: builtin('season_left', () => world.seasonLeft),
    year: builtin('year', () => world.year),
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
export function beeGlobals(world: World, bee: Bee): Record<string, Value> {
  const position = (name: string, v: Value, line: number): [number, number] => {
    if (Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1])) {
      const [x, y] = v as number[];
      if (!world.inside(x, y)) throw new ScriptError(`[${x}, ${y}] is outside the meadow.`, line);
      return [x, y];
    }
    throw new ScriptError(`${name}() needs a position like [3, 5], not ${format(v, true)}.`, line);
  };
  const scentName = (name: string, v: Value, line: number): string => {
    if (typeof v === 'string' && v.length >= 1 && v.length <= SCENT_NAME_MAX) return v;
    throw new ScriptError(`${name}() needs the scent's name as text, like "food" (up to ${SCENT_NAME_MAX} letters), not ${format(v, true)}.`, line);
  };
  const action = (name: string, run: string = name) =>
    builtin(name, (args, line) => {
      expectArgs(name, args, 0, line);
      return act(run);
    });

  return {
    ...coreBuiltins(text => world.say(bee, text)),
    ...colonyGlobals(world),

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
      return act('move_to', position('move_to', args[0], line));
    }),
    go_home: builtin('go_home', (args, line) => {
      expectArgs('go_home', args, 0, line);
      return act('move_to', [world.hive.x, world.hive.y]);
    }),
    collect: action('collect'),
    deposit: action('deposit'),
    eat: action('eat'),
    build: action('build'),
    die: action('die'),
    mark: builtin('mark', (args, line) => {
      expectArgs('mark', args, 1, line);
      return act('mark', [scentName('mark', args[0], line)]);
    }),

    // senses about this bee: these answer instantly
    get_pos: builtin('get_pos', () => [bee.x, bee.y]),
    hive_pos: builtin('hive_pos', () => [world.hive.x, world.hive.y]),
    nectar: builtin('nectar', () => bee.carrying),
    capacity: builtin('capacity', () => bee.capacity),
    at_hive: builtin('at_hive', () => world.atHive(bee)),
    energy: builtin('energy', () => Math.floor(bee.energy)),
    max_energy: builtin('max_energy', () => MAX_ENERGY),
    age: builtin('age', () => bee.age),
    life_left: builtin('life_left', () => bee.lifespan - bee.age),
    flower_here: builtin('flower_here', () => (world.flowerAt(bee.x, bee.y)?.nectar ?? 0) > 0),
    nearest_flower: builtin('nearest_flower', () => {
      const f = world.nearestFlower(bee);
      return f ? [f.x, f.y] : null;
    }),
    smell: builtin('smell', (args, line) => {
      expectArgs('smell', args, 1, line);
      const t = world.strongestScent(bee, scentName('smell', args[0], line));
      return t ? [t.x, t.y] : null;
    }),
    smell_here: builtin('smell_here', (args, line) => {
      expectArgs('smell_here', args, 1, line);
      return world.scentAt(bee.x, bee.y, scentName('smell_here', args[0], line));
    }),
  };
}

// Worker actions the queen might reach for; each gets a clear explanation instead of "not defined".
const WORKER_ONLY = ['move', 'move_to', 'go_home', 'collect', 'deposit', 'eat', 'build', 'mark', 'die'];

/** Everything the queen's script (queen.bee) can see. */
export function queenGlobals(world: World): Record<string, Value> {
  const globals: Record<string, Value> = {
    ...coreBuiltins(text => world.say('queen', text)),
    ...colonyGlobals(world),
    lay: builtin('lay', (args, line) => {
      expectArgs('lay', args, 0, line);
      return act('lay');
    }),
  };
  for (const name of WORKER_ONLY) {
    globals[name] = builtin(name, (_args, line) => {
      throw new ScriptError(`The queen never leaves the hive or works; ${name}() is for worker bees in forager.bee.`, line);
    });
  }
  return globals;
}
