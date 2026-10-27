import { describe, expect, it } from 'vitest';
import { DEFAULT_FORAGER, DEFAULT_QUEEN, DEFAULT_SHARED } from '../src/defaultScript';
import { parse } from '../src/lang/parser';
import {
  BEE_COST, BUILD_COST, HATCH_TICKS, LAY_TICKS, LIFESPAN_MAX, MARK_TICKS, MAX_ENERGY, MOVE_TICKS, SCENT_LIFE, SCENT_MAX,
  BLOOMS, bloom, COLS, ROWS, SEASON_TICKS, SHARED_LINE_BASE, START_BEES, START_COMB, World,
  BEE_HEALTH, HATCH_TICKS as HATCH, NEST_BUILD_TICKS, NEST_COST, NEST_HEALTH, NEST_WASPS, STING_DAMAGE, STING_TICKS, WASP_CAPACITY, WASP_COST, WASP_HEALTH,
} from '../src/sim/world';
import { DEFAULT_WASP } from '../src/defaultScript';

const IDLE_QUEEN = 'while True:\n    wait(1000)';
const GREEDY_QUEEN = 'while True:\n    if not lay():\n        wait(30)';

// every world gets the default shared.bee, which the default forager relies on
const SHARED = parse(DEFAULT_SHARED, SHARED_LINE_BASE + 1);

function makeWorld(forager: string, queen = IDLE_QUEEN, honey = 0, seed = 1, bees?: number): World {
  const world = new World({ forager: parse(forager), queen: parse(queen), shared: SHARED }, seed, { bees });
  world.colony.honey = honey;
  return world;
}

function simulate(world: World, ticks: number): World {
  for (let i = 0; i < ticks && world.running; i++) world.step();
  return world;
}

/** What scripts printed, leaving out the game's own notes and messages. */
const printed = (world: World) => world.colony.log.filter(l => !l.tone).map(l => l.text);
const year = SEASON_TICKS * 4;

describe('world', () => {
  it('plays out the same way for the same seed', () => {
    const a = simulate(makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN), 2500);
    const b = simulate(makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN), 2500);
    expect(a.colony.totalHoney).toBe(b.colony.totalHoney);
    expect(a.colony.bees.map(bee => [bee.x, bee.y, bee.energy])).toEqual(b.colony.bees.map(bee => [bee.x, bee.y, bee.energy]));
  });

  it('a move asked for on one tick lands MOVE_TICKS ticks later', () => {
    const world = simulate(makeWorld('move(East)'), MOVE_TICKS);
    expect(world.colony.bees[0].x).toBe(world.colony.hive.x);
    world.step();
    expect(world.colony.bees[0].x).toBe(world.colony.hive.x + 1);
  });

  it('bumping into the edge returns False', () => {
    const world = simulate(makeWorld('ok = True\nwhile ok:\n    ok = move(North)\nprint("stopped at", get_pos())'), 200);
    expect(printed(world)).toContain('stopped at [2, 0]');
  });

  it('stops on a forager script error and says which script and line', () => {
    const world = simulate(makeWorld('x = 1\nmove(Up)'), 5);
    expect(world.error).toMatchObject({ line: 2, file: 'forager' });
    expect(world.colony.log.some(l => l.tone === 'error')).toBe(true);
  });

  it('stops on a queen script error too', () => {
    const world = simulate(makeWorld('while True:\n    wait(10)', 'wait(5)\ncollect()'), 20);
    expect(world.error).toMatchObject({ line: 2, file: 'queen' });
    expect(world.error?.message).toMatch(/never leaves the hive/);
  });
});

describe('the default colony', () => {
  for (const seed of [1, 2, 3]) {
    it(`survives two years and grows past its start (seed ${seed})`, () => {
      const world = simulate(makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN, 0, seed), year * 2);
      expect(world.error).toBeNull();
      expect(world.colony.over).toBeNull();
      expect(world.colony.bees.length).toBeGreaterThan(0);
      expect(world.colony.totalHoney).toBeGreaterThan(200);
      expect(world.colony.comb).toBeGreaterThan(START_COMB);
    });
  }

  it('a queen who lays whenever she can starves the colony in its first winter', () => {
    const world = simulate(makeWorld(DEFAULT_FORAGER, GREEDY_QUEEN), year);
    expect(world.colony.over).not.toBeNull();
    expect(world.colony.fallen.some(b => b.death?.cause === 'starved')).toBe(true);
  });
});

describe('the queen, eggs and comb', () => {
  it('lay() costs honey, takes a cell, and the egg hatches later', () => {
    const world = makeWorld('while True:\n    wait(100)', 'lay()\nwait(3000)', BEE_COST);
    world.step();
    expect(world.colony.honey).toBe(0);
    expect(world.colony.eggs.length).toBe(1);
    expect(world.colony.space).toBe(START_COMB - START_BEES - 1);
    simulate(world, HATCH_TICKS);
    expect(world.colony.eggs.length).toBe(0);
    expect(world.colony.bees.length).toBe(START_BEES + 1);
  });

  it('lay() fails without honey or without free comb', () => {
    const poor = simulate(makeWorld('wait(100)', 'print(lay())', BEE_COST - 1), LAY_TICKS + 2);
    expect(printed(poor)).toContain('False');
    const full = makeWorld('wait(100)', 'print(lay())', 1000);
    full.colony.comb = START_BEES;
    simulate(full, LAY_TICKS + 2);
    expect(printed(full)).toContain('False');
  });

  it('the queen waits LAY_TICKS between eggs', () => {
    const world = simulate(makeWorld('wait(1000)', GREEDY_QUEEN, 1000), LAY_TICKS * 3);
    expect(world.colony.queen!.laid).toBe(3);
  });

  it('build() at the hive turns honey into one more cell of comb', () => {
    // honey for two cells, but the second try is away from the hive
    const world = simulate(makeWorld('print(build())\nmove(East)\nprint(build())', IDLE_QUEEN, BUILD_COST * 2), 200);
    expect(printed(world).filter(t => t === 'True' || t === 'False')).toEqual(['True', 'False']);
    expect(world.colony.comb).toBe(START_COMB + 1);
    expect(world.colony.honey).toBe(BUILD_COST);
  });
});

describe('one bee per tile', () => {
  it('never lets two bees share a tile outside the hive', () => {
    const world = makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN);
    for (let i = 0; i < 6000; i++) {
      world.step();
      const tiles = world.colony.bees.filter(b => !world.colony.atHive(b)).map(b => `${b.x},${b.y}`);
      expect(new Set(tiles).size).toBe(tiles.length);
    }
  });

  it('move() into an occupied tile returns False', () => {
    const world = makeWorld('if get_pos() == [4, 6]:\n    wait(500)\nelse:\n    print(move(East), move(East), get_pos())', IDLE_QUEEN, 0, 1, 2);
    world.colony.bees[1].x = 4;
    simulate(world, 60);
    expect(printed(world)).toContain('True False [3, 6]');
  });

  it('move_to() steers around a bee in the way', () => {
    const world = makeWorld('if get_pos() == [4, 6]:\n    wait(500)\nelse:\n    print(move_to([6, 6]), get_pos())', IDLE_QUEEN, 0, 1, 2);
    world.colony.bees[1].x = 4;
    simulate(world, 120);
    expect(printed(world)).toContain('True [6, 6]');
  });

  it('two bees flying head-on pass each other', () => {
    const src = 'if get_pos()[0] < 5:\n    ok = move_to([8, 3])\nelse:\n    ok = move_to([3, 3])\nprint(ok, get_pos())';
    const world = makeWorld(src, IDLE_QUEEN, 0, 1, 2);
    Object.assign(world.colony.bees[0], { x: 3, y: 3 });
    Object.assign(world.colony.bees[1], { x: 8, y: 3 });
    simulate(world, 200);
    expect(printed(world).sort()).toEqual(['True [3, 3]', 'True [8, 3]']);
  });

  it('move_to() gives up and returns False when the spot stays taken', () => {
    const world = makeWorld('if get_pos() == [4, 6]:\n    wait(500)\nelse:\n    print(move_to([4, 6]), get_pos())', IDLE_QUEEN, 0, 1, 2);
    world.colony.bees[1].x = 4;
    simulate(world, 120);
    expect(printed(world)).toContain('False [3, 6]');
  });

  it('the hive holds any number of bees', () => {
    const world = simulate(makeWorld('move(East)\ngo_home()\nprint(at_hive())', IDLE_QUEEN, 0, 1, 4), 100);
    expect(printed(world)).toEqual(['True', 'True', 'True', 'True']);
  });

  it('nearest_flower() skips a flower another bee is on', () => {
    const src = 'if get_pos() == [4, 9]:\n    wait(500)\nelse:\n    print(nearest_flower())';
    const world = new World({ forager: parse(src), queen: parse(IDLE_QUEEN) }, 1, { bees: 2, flowers: [[4, 9], [5, 9]] });
    Object.assign(world.colony.bees[1], { x: 4, y: 9 });
    simulate(world, 3);
    expect(printed(world)[0]).toBe('[5, 9]');
  });
});

describe('energy, food and old age', () => {
  it('bees that never eat starve, and the colony dies out', () => {
    const world = simulate(makeWorld('while True:\n    move(East)\n    move(West)'), 2000);
    expect(world.colony.fallen.map(b => b.death?.cause)).toEqual(['starved']);
    expect(world.colony.log.some(l => l.text.startsWith('Starved at'))).toBe(true);
    expect(world.colony.over).not.toBeNull();
  });

  it('eating at the hive turns honey into energy', () => {
    const src = 'for i in range(15):\n    move(East)\nfor i in range(15):\n    move(West)\nate = eat()\nprint(ate, energy())';
    const world = simulate(makeWorld(src, IDLE_QUEEN, 5), 400);
    expect(printed(world)).toContain(`1 ${MAX_ENERGY}`);
    expect(world.colony.honey).toBe(4);
  });

  it('eating away from the hive does nothing', () => {
    const world = simulate(makeWorld('move(East)\nprint(eat())', IDLE_QUEEN, 5), 100);
    expect(printed(world)).toContain('0');
    expect(world.colony.honey).toBe(5);
  });

  it('well-fed bees still die of old age', () => {
    const world = simulate(makeWorld('while True:\n    eat()', IDLE_QUEEN, 1000), LIFESPAN_MAX + 1);
    const first = world.colony.fallen.find(b => b.id === 1);
    expect(first?.death?.cause).toBe('old age');
    expect(first!.age).toBe(first!.lifespan);
  });
});

describe('roles', () => {
  const SAY_AND_WAIT = (text: string) => `print("${text}")\nwhile True:\n    wait(100)`;
  function roleWorld(queen: string, roles: Record<string, string>, forager = SAY_AND_WAIT('forager here'), shared = '') {
    const programs = {
      forager: parse(forager),
      queen: parse(queen),
      roles: Object.fromEntries(Object.entries(roles).map(([name, src]) => [name, parse(src)])),
      shared: parse(shared, SHARED_LINE_BASE + 1),
    };
    const world = new World(programs, 1);
    world.colony.honey = 50;
    return world;
  }

  it('lay("builder") hatches a builder running its own script, and lay() a forager', () => {
    const world = simulate(roleWorld('lay("builder")\nlay()\nwait(1000)', { builder: SAY_AND_WAIT('builder here') }), HATCH_TICKS + 100);
    expect(world.colony.bees.map(b => b.role)).toEqual(['forager', 'builder', 'forager']);
    expect(printed(world).sort()).toEqual(['builder here', 'forager here', 'forager here']);
  });

  it('laying a role that does not exist stops the game and lists the real ones', () => {
    const world = simulate(roleWorld('lay("buidler")', { builder: SAY_AND_WAIT('builder') }), 5);
    expect(world.error).toMatchObject({ file: 'queen', line: 1, message: 'There\'s no role called "buidler". Your roles: forager, builder, wasp.' });
  });

  it('roles() lists every role and role_count() counts living bees of one', () => {
    const queen = 'lay("builder")\nwait(400)\nprint(roles(), role_count("builder"), role_count("forager"))';
    const world = simulate(roleWorld(queen, { builder: SAY_AND_WAIT('b') }), 500);
    expect(printed(world)).toContain('["forager", "builder", "wasp"] 1 1');
  });

  it('the queen has no role()', () => {
    const world = simulate(roleWorld('print(role())', {}), 5);
    expect(world.error?.message).toContain('for worker bees');
  });

  it('every role can call functions from shared.bee', () => {
    const shared = 'def greet():\n    print("hi from", role())';
    const world = simulate(roleWorld('lay("builder")\nwait(1000)', { builder: 'greet()' }, 'greet()', shared), HATCH_TICKS + 50);
    expect(printed(world).sort()).toEqual(['hi from builder', 'hi from forager']);
  });

  it('errors point at the file and line they happened in', () => {
    const shared = 'def boom():\n    return 1 / 0';
    const fromShared = simulate(roleWorld('wait(1000)', {}, 'boom()', shared), 3);
    expect(fromShared.error).toMatchObject({ file: 'shared', line: 2, beeId: 1 });
    expect(fromShared.colony.log.some(l => l.text.startsWith('shared.bee line 2:'))).toBe(true);

    const fromRole = simulate(roleWorld('lay("builder")\nwait(1000)', { builder: 'wait(1)\nprint(nope)' }), HATCH_TICKS + 50);
    expect(fromRole.error).toMatchObject({ file: 'builder', line: 2 });
  });
});

describe('die()', () => {
  it('ends the bee at once, frees its cell of comb, and stops its script', () => {
    const world = makeWorld('move(East)\ndie()\nprint("still here")', IDLE_QUEEN, 0, 1, 2);
    const space = world.colony.space;
    simulate(world, MOVE_TICKS + 2);
    expect(world.colony.bees).toEqual([]);
    expect(world.colony.fallen.map(b => b.death?.cause)).toEqual(['by choice', 'by choice']);
    expect(world.colony.space).toBe(space + 2);
    expect(printed(world)).toEqual([]);
    expect(world.colony.log.some(l => l.text.startsWith('Gave its life'))).toBe(true);
  });

  it('the queen cannot die()', () => {
    const world = simulate(makeWorld('wait(1000)', 'die()'), 5);
    expect(world.error?.message).toContain('for worker bees');
  });
});

describe('seasons', () => {
  it('each season grows its own kind of flower in new places, and winter grows none', () => {
    const world = makeWorld('while True:\n    eat()', GREEDY_QUEEN, 5000);
    const layouts: string[] = [];
    for (const season of ['spring', 'summer', 'autumn'] as const) {
      expect(world.season).toBe(season);
      expect(world.flowers.length).toBeGreaterThan(0);
      expect(world.flowers.every(f => f.kind === BLOOMS[season].kind && f.nectar === f.max)).toBe(true);
      layouts.push(JSON.stringify(world.flowers.map(f => [f.x, f.y])));
      simulate(world, SEASON_TICKS);
    }
    expect(new Set(layouts).size).toBe(3);
    expect(world.season).toBe('winter');
    expect(world.flowers).toEqual([]);
    simulate(world, SEASON_TICKS);
    expect(world.year).toBe(2);
    expect(world.flowers.every(f => f.kind === 'clover' && f.nectar === f.max)).toBe(true);
    expect(JSON.stringify(world.flowers.map(f => [f.x, f.y]))).not.toBe(layouts[0]); // a new year, a new meadow
  });

  it('the same seed always grows the same meadow, and another seed a different one', () => {
    const hive = { x: 2, y: 6 };
    expect(bloom(7, 1, 'summer', hive)).toEqual(bloom(7, 1, 'summer', hive));
    expect(bloom(7, 1, 'summer', hive)).not.toEqual(bloom(8, 1, 'summer', hive));
  });

  it('patches stay inside the meadow, off the hive, and never overlap', () => {
    const hive = { x: 2, y: 6 };
    for (let seed = 1; seed <= 50; seed++) {
      for (const season of ['spring', 'summer', 'autumn'] as const) {
        const flowers = bloom(seed, 1, season, hive);
        const b = BLOOMS[season];
        expect(flowers.length).toBeGreaterThanOrEqual(b.size[0] * 2); // at least two patches always fit
        const keys = flowers.map(f => f.y * COLS + f.x);
        expect(new Set(keys).size).toBe(keys.length);
        for (const f of flowers) {
          expect(f.x >= 0 && f.y >= 0 && f.x < COLS && f.y < ROWS).toBe(true);
          expect(Math.abs(f.x - hive.x) <= 1 && f.y >= hive.y - 3 && f.y <= hive.y + 1).toBe(false);
        }
      }
    }
  });

  it('bees age at half speed in winter', () => {
    const world = simulate(makeWorld('while True:\n    eat()', GREEDY_QUEEN, 5000), SEASON_TICKS * 3);
    const before = world.colony.bees[0].age;
    simulate(world, 100);
    expect(world.colony.bees[0].age - before).toBe(50);
  });
});

describe('scent', () => {
  it('mark() scents the tile the bee is on, and it fades evenly to nothing', () => {
    const world = simulate(makeWorld('move(East)\nmark("food")'), MOVE_TICKS + MARK_TICKS + 2);
    const { x, y } = { x: world.colony.hive.x + 1, y: world.colony.hive.y };
    expect(world.colony.scentAt(x, y, 'food')).toBe(SCENT_MAX);
    expect(world.colony.scentAt(x, y, 'danger')).toBe(0);
    simulate(world, SCENT_LIFE / 2);
    expect(world.colony.scentAt(x, y, 'food')).toBeGreaterThan(SCENT_MAX / 2 - 3);
    expect(world.colony.scentAt(x, y, 'food')).toBeLessThanOrEqual(SCENT_MAX / 2 + 1);
    simulate(world, SCENT_LIFE / 2 + 60);
    expect(world.colony.scentAt(x, y, 'food')).toBe(0);
    expect(world.colony.scents.size).toBe(0); // faded marks are forgotten
  });

  it('smell() finds the strongest mark in range, and smell_here() reads the bee\'s own tile', () => {
    const script = [
      'move_to([5, 6])', 'mark("food")', 'wait(100)', 'move_to([6, 6])', 'mark("food")', 'move_to([4, 6])',
      'print(smell("food"), smell_here("food"), smell("danger"))',
      'move_to([19, 6])', 'print(smell("food"))', // 13 tiles from the nearest mark, past SMELL_RANGE
    ].join('\n');
    const world = simulate(makeWorld(script), 900);
    expect(world.error).toBeNull();
    expect(printed(world)).toEqual(['[6, 6] 0 None', 'None']);
  });

  it('a newer mark beats an older one, and marking again makes it fresh', () => {
    const world = simulate(makeWorld('move_to([5, 6])\nmark("x")\nwait(300)\nmark("x")\nprint(smell_here("x"))'), 900);
    expect(printed(world)).toEqual([String(SCENT_MAX)]);
  });

  it('scent names must be text', () => {
    const world = simulate(makeWorld('mark(5)'), 5);
    expect(world.error?.message).toContain('needs the scent\'s name as text');
  });

  it('the queen cannot mark', () => {
    const world = simulate(makeWorld('wait(1000)', 'mark("food")'), 5);
    expect(world.error?.message).toContain('for worker bees');
  });
});

describe('running on a server', () => {
  const programs = (forager: string, queen = DEFAULT_QUEEN) => ({ forager: parse(forager), queen: parse(queen), shared: SHARED });

  it('a saved world restores with the same stores, bodies, scent and random sequence', () => {
    const a = simulate(new World(programs(DEFAULT_FORAGER), 7), 3000);
    const save = JSON.parse(JSON.stringify(a.save())); // through JSON, as the database stores it
    const b = World.restore(programs(DEFAULT_FORAGER), save);
    expect([b.tick, b.colony.honey, b.colony.comb, b.colony.deaths, b.colony.eggs.length]).toEqual([a.tick, a.colony.honey, a.colony.comb, a.colony.deaths, a.colony.eggs.length]);
    expect(b.colony.bees.map(x => [x.id, x.role, x.x, x.y, x.energy, x.carrying, x.age])).toEqual(a.colony.bees.map(x => [x.id, x.role, x.x, x.y, x.energy, x.carrying, x.age]));
    expect(b.flowers).toEqual(a.flowers);
    expect([...b.colony.scents.keys()]).toEqual([...a.colony.scents.keys()]);
    expect(b.rng.state()).toBe(a.rng.state());
    expect(b.colony.bees.every(x => x.action === null)).toBe(true); // scripts start again from the top
  });

  it('two restores of one save play out exactly alike, and keep the colony going', () => {
    const save = JSON.parse(JSON.stringify(simulate(new World(programs(DEFAULT_FORAGER), 3), 2000).save()));
    const b = simulate(World.restore(programs(DEFAULT_FORAGER), save), 2000);
    const c = simulate(World.restore(programs(DEFAULT_FORAGER), save), 2000);
    expect(b.save()).toEqual(c.save());
    expect(b.colony.totalHoney).toBeGreaterThan(save.colonies[0].totalHoney);
  });

  it('deploy() restarts every script on the new code and keeps the bodies', () => {
    const world = simulate(new World(programs('move(East)\nmove(East)\nwhile True:\n    wait(100)'), 1, { bees: 2 }), 30);
    const before = world.colony.bees.map(b => [b.id, b.x, b.y, b.energy]);
    world.colony.deploy(programs('print("v2 at", get_pos())\nwhile True:\n    wait(100)'));
    expect(world.colony.bees.map(b => [b.id, b.x, b.y, b.energy])).toEqual(before);
    simulate(world, 2);
    expect(printed(world).filter(t => t.startsWith('v2 at')).length).toBe(2);
  });

  it('bees of a role that is no longer deployed stop, with a note', () => {
    const roles = { builder: parse('while True:\n    wait(10)') };
    const world = new World({ ...programs('while True:\n    wait(10)', 'lay("builder")\nwhile True:\n    wait(100)'), roles }, 1);
    world.colony.honey = 20;
    simulate(world, HATCH_TICKS + 40);
    expect(world.colony.bees.some(b => b.role === 'builder')).toBe(true);
    world.colony.deploy(programs('while True:\n    wait(10)', 'while True:\n    wait(100)'));
    expect(world.colony.log.some(l => l.text.startsWith('There is no builder.bee any more'))).toBe(true);
    simulate(world, 20);
    expect(world.running).toBe(true);
  });

  it('with haltOnError off, a failing script stops only its own bee', () => {
    const world = new World(programs('wait(5)\nprint(1 / 0)', 'while True:\n    wait(10)'), 1, { haltOnError: false, bees: 2 });
    simulate(world, 50);
    expect(world.error).toBeNull();
    expect(world.running).toBe(true);
    expect(world.tick).toBe(50);
    expect(world.colony.log.filter(l => l.tone === 'error').length).toBe(2);
    expect(world.colony.bees.every(b => b.runner.finished)).toBe(true);
  });

  it('log lines keep counting past the 500 the log holds', () => {
    const world = simulate(makeWorld('for i in range(700):\n    print(i)\nwhile True:\n    wait(100)'), 30);
    const lines = world.colony.log.filter(l => !l.tone);
    expect(world.colony.log.length).toBe(500);
    expect(lines.at(-1)?.text).toBe('699');
    expect(world.colony.log.at(-1)!.seq).toBe(world.colony.logCount - 1);
    expect(world.colony.log[0].seq).toBe(world.colony.logCount - 500);
  });
});

describe('a multiplayer world of many maps', () => {
  const programs = (forager: string, queen = IDLE_QUEEN) => ({ forager: parse(forager), queen: parse(queen), shared: SHARED });
  const grid = (seed = 5) => new World(null, seed, { maps: [5, 5], haltOnError: false });
  const said = (c: { log: { text: string; tone?: string }[] }) => c.log.filter(l => !l.tone).map(l => l.text);

  it('starts empty, keeps its clock running, and grows flowers on every map', () => {
    const world = grid();
    expect([world.width, world.height, world.colonies.length]).toEqual([5 * COLS, 5 * ROWS, 0]);
    simulate(world, 10);
    expect(world.tick).toBe(10);
    for (let my = 0; my < 5; my++) for (let mx = 0; mx < 5; mx++) {
      expect(world.flowers.some(f => world.mapAt(f).x === mx && world.mapAt(f).y === my)).toBe(true);
    }
  });

  it('map [0, 0] grows the same meadow as a single player game on that seed', () => {
    const single = new World(null, 9);
    const multi = new World(null, 9, { maps: [5, 5] });
    expect(multi.flowers.filter(f => f.x < COLS && f.y < ROWS)).toEqual(single.flowers);
  });

  it('founds colonies on their own maps, with world positions for everything a script sees', () => {
    const world = grid();
    const a = world.found(programs('print(hive_pos(), my_map(), map_at([45, 13]))\nwhile True:\n    wait(100)'), { x: 2, y: 1 }, 'ada');
    simulate(world, 2);
    expect(a.hive).toEqual({ x: 42, y: 18 });
    expect(a.bees[0]).toMatchObject({ x: 42, y: 18 });
    expect(said(a)).toEqual(['[42, 18] [2, 1] [2, 1]']);
    expect(world.colonyOn({ x: 2, y: 1 })).toBe(a);
    expect(world.colonyOn({ x: 3, y: 1 })).toBeNull();
  });

  it('bees fly across map borders, and can only deposit at their own hive', () => {
    const world = grid();
    const go = 'move_to([25, 6])\nprint("at", get_pos(), "on map", map_at(get_pos()))\ngo_home()\nprint(deposit())\nwhile True:\n    wait(100)';
    const a = world.found(programs(go), { x: 0, y: 0 }, 'ada');
    a.bees[0].carrying = 2;
    simulate(world, 23 * 2 * MOVE_TICKS + 20);
    expect(said(a)).toEqual(['at [25, 6] on map [1, 0]', '2']);
    expect(a.honey).toBe(2);

    const b = world.found(programs('move_to([2, 6])\nprint(deposit())\nwhile True:\n    wait(100)'), { x: 1, y: 0 }, 'bo');
    b.bees[0].carrying = 3;
    simulate(world, 200);
    expect(said(b)).toEqual(['0']); // that's ada's hive, not bo's
    expect(a.honey).toBe(2);
  });

  it("neighbors share flowers and can't fly through each other's bees", () => {
    const world = grid();
    const sit = 'move_to([20, 6])\nwhile True:\n    wait(100)';
    const a = world.found(programs(sit), { x: 0, y: 0 }, 'ada');
    const b = world.found(programs('wait(150)\nprint(move_to([20, 6]))\nwhile True:\n    wait(100)'), { x: 1, y: 0 }, 'bo');
    simulate(world, 200);
    expect(a.bees[0]).toMatchObject({ x: 20, y: 6 });
    expect(said(b)).toEqual(['False']); // ada's bee holds the tile
    const f = world.flowers.find(fl => fl.nectar > 0)!;
    world.taken(f); // a flower is anyone's
    expect(world.nearestFlower({ ...a.bees[0], x: f.x, y: f.y })).toBe(f);
  });

  it("smells only its own colony's scent", () => {
    const world = grid();
    const a = world.found(programs('mark("food")\nwhile True:\n    wait(100)'), { x: 0, y: 0 }, 'ada');
    const b = world.found(programs('wait(20)\nprint(smell("food"))\nwhile True:\n    wait(100)'), { x: 0, y: 1 }, 'bo');
    b.bees[0].x = a.hive.x;
    b.bees[0].y = a.hive.y + 1;
    simulate(world, 30);
    expect(a.scents.size).toBe(1);
    expect(said(b)).toEqual(['None']);
  });

  it('a colony that dies out can be removed, freeing its map; others keep going', () => {
    const world = grid();
    const a = world.found(programs('die()'), { x: 0, y: 0 }, 'ada');
    const b = world.found(programs('while True:\n    wait(10)'), { x: 1, y: 0 }, 'bo');
    simulate(world, 5);
    expect(a.over).toMatch(/died out/);
    expect(b.over).toBeNull();
    world.remove(a);
    expect(world.colonyOn({ x: 0, y: 0 })).toBeNull();
    simulate(world, 5);
    expect(world.tick).toBe(10);
  });

  it('saves and restores every colony, each with its own scripts', () => {
    const world = grid();
    world.found(programs(DEFAULT_FORAGER, DEFAULT_QUEEN), { x: 1, y: 1 }, 'ada');
    world.found(programs(DEFAULT_FORAGER, DEFAULT_QUEEN), { x: 2, y: 1 }, 'bo');
    simulate(world, 1500);
    const save = JSON.parse(JSON.stringify(world.save()));
    const scripts = { ada: programs(DEFAULT_FORAGER, DEFAULT_QUEEN), bo: programs(DEFAULT_FORAGER, DEFAULT_QUEEN) };
    const back = World.restore(c => scripts[c.owner as 'ada' | 'bo'], save, { haltOnError: false });
    expect(back.colonies.map(c => [c.owner, c.map, c.honey, c.bees.length])).toEqual(world.colonies.map(c => [c.owner, c.map, c.honey, c.bees.length]));
    const again = World.restore(c => scripts[c.owner as 'ada' | 'bo'], save, { haltOnError: false });
    simulate(back, 1000);
    simulate(again, 1000);
    expect(back.save()).toEqual(again.save());
    expect(back.colonies.every(c => c.totalHoney > 0)).toBe(true);
  });
});

describe('health, raids and wasps', () => {
  const programs = (forager: string, queen = IDLE_QUEEN, wasp = IDLE_QUEEN) => ({ forager: parse(forager), queen: parse(queen), wasp: parse(wasp), shared: SHARED });
  const grid = () => new World(null, 5, { maps: [5, 5], haltOnError: false });
  const said = (c: { log: { text: string; tone?: string }[] }) => c.log.filter(l => !l.tone).map(l => l.text);
  const raids = (c: { log: { text: string; tone?: string }[] }) => c.log.filter(l => l.tone === 'raid' || l.tone === 'death').map(l => l.text);

  it('bees start at full health, and eating at the hive heals 2 health per honey', () => {
    const world = makeWorld('print(health(), max_health())\nprint(eat(), health())\nwhile True:\n    wait(100)', IDLE_QUEEN, 10);
    world.colony.bees[0].health = 3;
    simulate(world, 20);
    expect(printed(world)).toEqual(['3 10', '4 10']); // 7 health needs 4 honey; energy was already full
    expect(world.colony.honey).toBe(6);
  });

  it('steal() takes honey from another hive, as much as the bee can carry, and deposit() banks it at home', () => {
    const world = new World(programs('print(steal())\nmove_to([12, 6])\nprint(steal(), nectar(), owner_at([12, 6]))\ngo_home()\nprint(deposit())\nwhile True:\n    wait(100)'), 1, {
      rival: { x: 12, y: 6, honey: 2, owner: 'rival' },
    });
    simulate(world, 200);
    expect(printed(world)).toEqual(['0', '2 2 rival', '2']); // nothing to steal at home; the rival only had 2
    expect(world.colonies[1].honey).toBe(0);
    expect(world.colony.honey).toBe(2);
    expect(world.colonies[1].log.some(l => l.tone === 'raid' && l.text.includes('stole 2 honey'))).toBe(true);
    expect(world.colony.stolen).toBe(2);
  });

  it('with a nest, the queen lays wasps for more honey; they are tougher, carry more, and run wasp.bee', () => {
    const world = new World(programs('while True:\n    wait(100)', 'print(lay("wasp"))\nwhile True:\n    wait(100)', 'print(role(), health(), capacity())\nwhile True:\n    wait(100)'), 1, { nest: [5, 6] });
    world.colony.honey = WASP_COST;
    simulate(world, HATCH + 40);
    const wasp = world.colony.bees.find(b => b.role === 'wasp')!;
    expect(wasp).toMatchObject({ health: WASP_HEALTH, maxHealth: WASP_HEALTH, capacity: WASP_CAPACITY });
    expect(world.colony.honey).toBe(0);
    expect(printed(world)).toEqual(['True', `wasp ${WASP_HEALTH} ${WASP_CAPACITY}`]);
  });

  it("wasps can't collect, and only wasps can sting", () => {
    const wasp = new World(programs('wait(1000)', IDLE_QUEEN, 'collect()'), 1, { bees: 0, wasps: 1 });
    simulate(wasp, 5);
    expect(wasp.error?.message).toMatch(/Wasps can't collect nectar/);
    const bee = simulate(makeWorld('sting([3, 6])'), 5);
    expect(bee.error?.message).toMatch(/Only wasps can sting/);
    const far = new World(programs('wait(1000)', IDLE_QUEEN, 'sting([9, 9])'), 1, { bees: 0, wasps: 1 });
    expect(simulate(far, 5).error?.message).toMatch(/right next to the wasp/);
  });

  it("a wasp stings an enemy bee to death; both colonies' logs tell it", () => {
    const world = grid();
    const a = world.found(programs('move_to([22, 6])\nwhile True:\n    wait(100)'), { x: 1, y: 0 }, 'ada'); // hive [22, 6]
    const b = world.found(programs('while True:\n    wait(100)', IDLE_QUEEN,
      'move_to([21, 6])\nwhile True:\n    e = enemies_near()\n    if e and distance(e[0], get_pos()) == 1:\n        print(owner_at(e[0]), sting(e[0]))\n    else:\n        wait(5)'), { x: 0, y: 0 }, 'bo');
    world.spawn(b, 'wasp');
    simulate(world, 300);
    expect(a.bees).toHaveLength(0);
    expect(a.deaths).toBe(1);
    expect(raids(a).some(t => t.startsWith('Stung to death at [22, 6] by bo\'s wasp'))).toBe(true);
    expect(said(b)).toEqual(['ada True', 'ada True']); // BEE_HEALTH / STING_DAMAGE stings
    expect(BEE_HEALTH / STING_DAMAGE).toBe(2);
    expect(b.kills).toBe(1);
  });

  it('the default wasp.bee guards its hive against a raider', () => {
    const world = grid();
    const raid = 'move_to([22, 6])\nprint("took", steal())\ngo_home()\nprint("banked", deposit())\nwhile True:\n    wait(100)';
    const robber = world.found(programs(raid), { x: 0, y: 0 }, 'robber');
    const home = world.found({ ...programs('while True:\n    wait(100)'), wasp: parse(DEFAULT_WASP) }, { x: 1, y: 0 }, 'home');
    home.honey = 50;
    world.spawn(home, 'wasp');
    simulate(world, 400);
    expect(robber.bees).toHaveLength(0); // stung on its way out
    expect(said(robber)).toEqual(['took 3']);
    expect(home.kills).toBe(1);
  });

  it('wild wasps sting bees near their nest, but never in a hive, and rest in winter', () => {
    const world = new World(programs('move_to([10, 5])\nwhile True:\n    wait(100)'), 1, { nests: [[12, 5]], nestWasps: 1, bees: 1 });
    simulate(world, 200);
    expect(world.colony.bees).toHaveLength(0);
    expect(raids(world.colony).some(t => t.includes('by a wild wasp'))).toBe(true);

    const safe = new World(programs('while True:\n    wait(100)'), 1, { nests: [[5, 6]], nestWasps: NEST_WASPS, bees: 2 });
    simulate(safe, 600);
    expect(safe.colony.bees).toHaveLength(2); // inside the hive at [2, 6]
  });

  it("a player's wasps can destroy a nest; it hangs again on a free map next spring", () => {
    const world = grid();
    const c = world.found(programs('while True:\n    wait(100)', IDLE_QUEEN, 'move_to([11, 5])\nwhile True:\n    if not sting([12, 5]):\n        wait(5)'), { x: 0, y: 0 }, 'ada');
    world.addNest({ x: 12, y: 5 }, 0);
    world.spawn(c, 'wasp');
    simulate(world, 120 + (NEST_HEALTH / STING_DAMAGE) * STING_TICKS);
    expect(world.nests).toHaveLength(0);
    expect(c.kills).toBe(1);
    expect(raids(c).some(t => t.startsWith('Destroyed the wild wasp nest'))).toBe(true);
    simulate(world, SEASON_TICKS * 4); // to next spring
    expect(world.nests).toHaveLength(1);
    expect(world.colonyOn(world.mapAt(world.nests[0]))).toBeNull();
  });

  it('a multiplayer world hangs its nests on free maps, and saves and restores them with every body\'s health', () => {
    const world = new World(null, 8, { maps: [5, 5], nests: 3, haltOnError: false });
    expect(world.nests).toHaveLength(3);
    expect(new Set(world.nests.map(n => `${world.mapAt(n).x},${world.mapAt(n).y}`)).size).toBe(3);
    const c = world.found(programs(DEFAULT_FORAGER, DEFAULT_QUEEN), { x: 2, y: 2 }, 'ada');
    simulate(world, 500);
    c.bees[0].health = 4;
    const save = JSON.parse(JSON.stringify(world.save()));
    const back = World.restore(programs(DEFAULT_FORAGER, DEFAULT_QUEEN), save, { haltOnError: false });
    expect(back.nests.map(n => [n.x, n.y, n.wasps.length])).toEqual(world.nests.map(n => [n.x, n.y, n.wasps.length]));
    expect(back.colony.bees[0].health).toBe(4);
    const again = World.restore(programs(DEFAULT_FORAGER, DEFAULT_QUEEN), save, { haltOnError: false });
    simulate(back, 800);
    simulate(again, 800);
    expect(back.save()).toEqual(again.save());
  });
});

describe("a colony's wasp nest", () => {
  const programs = (queen: string, wasp = IDLE_QUEEN, forager = 'while True:\n    wait(100)') => ({ forager: parse(forager), queen: parse(queen), wasp: parse(wasp), shared: SHARED });
  const said = (c: { log: { who: unknown; text: string; tone?: string }[] }) => c.log.filter(l => !l.tone).map(l => l.text);

  it('wasps need no comb: the queen lays them into a full hive, and they leave the comb free', () => {
    const world = new World(programs('print(space(), lay("wasp"), lay("wasp"), space())\nwhile True:\n    wait(100)'), 1, { nest: [6, 3], honey: 2 * WASP_COST, comb: 1 });
    simulate(world, 2 * 30 + HATCH + 10);
    expect(said(world.colony)).toEqual(['0 True True 0']);
    expect(world.colony.bees.filter(b => b.role === 'wasp')).toHaveLength(2);
    expect(world.colony.space).toBe(0); // still just the forager in the one cell
  });

  it("can't lay wasps without one: lay() says False, once explained, and costs nothing", () => {
    const world = new World(programs('print(lay("wasp"))\nprint(lay("wasp"))\nwhile True:\n    wait(100)'), 1, { honey: 100 });
    simulate(world, 80);
    expect(said(world.colony)).toEqual(['False', 'False']);
    expect(world.colony.log.filter(l => l.text.startsWith('Wasps hatch at a wasp nest'))).toHaveLength(1);
    expect(world.colony.honey).toBe(100);
  });

  it('build_nest() costs 150 honey and the queen 100 ticks; then wasps hatch at the nest', () => {
    const world = new World(programs('print(build_nest([6, 3]), nest_pos())\nprint(lay("wasp"))\nwhile True:\n    wait(100)'), 1, { honey: NEST_COST + WASP_COST });
    simulate(world, NEST_BUILD_TICKS - 2);
    expect(world.colony.nest).toBeNull();
    simulate(world, 4);
    expect(world.colony.nest).toMatchObject({ x: 6, y: 3, health: NEST_HEALTH });
    simulate(world, HATCH + 40);
    expect(said(world.colony)).toEqual(['True [6, 3]', 'True']);
    expect(world.colony.bees.find(b => b.role === 'wasp')).toMatchObject({ x: 6, y: 3 });
    expect(world.colony.honey).toBe(0);
  });

  it('refuses a second nest, too little honey, the hive or a flower, and another map', () => {
    const tries = 'print(build_nest([2, 6]))\nprint(build_nest([4, 9]))\nprint(build_nest([6, 3]))\nprint(build_nest([7, 3]))\nwhile True:\n    wait(100)';
    const world = new World(programs(tries), 1, { honey: NEST_COST + 10, flowers: [[4, 9]] });
    simulate(world, NEST_BUILD_TICKS * 4 + 10);
    expect(said(world.colony)).toEqual(['False', 'False', 'True', 'False']); // the hive, a flower, built, already have one
    const poor = simulate(new World(programs('print(build_nest([6, 3]))'), 1, { honey: NEST_COST - 1 }), NEST_BUILD_TICKS + 5);
    expect(said(poor.colony)).toEqual(['False']);
    const far = simulate(new World(null, 1, { maps: [2, 1] }), 0);
    far.found(programs('build_nest([25, 3])'), { x: 0, y: 0 }, 'ada');
    simulate(far, 3);
    expect(far.colony.log.some(l => l.tone === 'error' && l.text.includes('your own map'))).toBe(true);
    const worker = simulate(makeWorld('build_nest([6, 3])'), 3);
    expect(worker.error?.message).toMatch(/The queen builds the wasp nest/);
  });

  it("an enemy's wasps can sting it down; the queen can't lay wasps until a new one, but wasps live on", () => {
    const world = new World(null, 5, { maps: [5, 5], haltOnError: false });
    // its wasp waits in the hive: a wasp on the nest tile would take the stings first
    const home = world.found(programs('while True:\n    wait(100)', 'go_home()\nwhile True:\n    wait(100)'), { x: 0, y: 0 }, 'home');
    home.nest = { x: 6, y: 3, health: NEST_HEALTH, maxHealth: NEST_HEALTH };
    world.spawn(home, 'wasp');
    const enemy = world.found(programs(IDLE_QUEEN, 'move_to([7, 3])\nwhile sting([6, 3]):\n    pass\nprint("down")\nwhile True:\n    wait(100)'), { x: 1, y: 0 }, 'enemy');
    world.spawn(enemy, 'wasp');
    simulate(world, 150 + (NEST_HEALTH / STING_DAMAGE) * STING_TICKS);
    expect(home.nest).toBeNull();
    expect(home.bees.some(b => b.role === 'wasp')).toBe(true);
    expect(enemy.kills).toBe(1);
    expect(home.log.some(l => l.tone === 'raid' && l.text.includes("destroyed our wasp nest"))).toBe(true);
    expect(said(enemy)).toEqual(['down']);
  });

  it('wild wasps leave it alone, and it survives a save and restore', () => {
    const world = new World(programs(IDLE_QUEEN), 1, { nest: [8, 5], nests: [[10, 5]], nestWasps: NEST_WASPS, honey: 20 });
    simulate(world, 600);
    expect(world.colony.nest).toMatchObject({ health: NEST_HEALTH });
    const back = World.restore(programs(IDLE_QUEEN), JSON.parse(JSON.stringify(world.save())));
    expect(back.colony.nest).toEqual(world.colony.nest);
    expect(back.ownerAt({ x: 8, y: 5 })).toBe('you');
  });
});
