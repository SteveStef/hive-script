import { describe, expect, it } from 'vitest';
import { DEFAULT_FORAGER, DEFAULT_QUEEN } from '../src/defaultScript';
import { parse } from '../src/lang/parser';
import {
  BEE_COST, BUILD_COST, HATCH_TICKS, LAY_TICKS, LIFESPAN_MAX, MARK_TICKS, MAX_ENERGY, MOVE_TICKS, SCENT_LIFE, SCENT_MAX,
  BLOOMS, bloom, COLS, ROWS, SEASON_TICKS, START_BEES, START_COMB, World,
} from '../src/sim/world';

const IDLE_QUEEN = 'while True:\n    wait(1000)';
const GREEDY_QUEEN = 'while True:\n    if not lay():\n        wait(30)';

function makeWorld(forager: string, queen = IDLE_QUEEN, honey = 0, seed = 1, bees?: number): World {
  const world = new World({ forager: parse(forager), queen: parse(queen) }, seed, { bees });
  world.honey = honey;
  return world;
}

function simulate(world: World, ticks: number): World {
  for (let i = 0; i < ticks && world.running; i++) world.step();
  return world;
}

/** What scripts printed, leaving out the game's own notes and messages. */
const printed = (world: World) => world.log.filter(l => !l.tone).map(l => l.text);
const year = SEASON_TICKS * 4;

describe('world', () => {
  it('plays out the same way for the same seed', () => {
    const a = simulate(makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN), 2500);
    const b = simulate(makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN), 2500);
    expect(a.totalHoney).toBe(b.totalHoney);
    expect(a.bees.map(bee => [bee.x, bee.y, bee.energy])).toEqual(b.bees.map(bee => [bee.x, bee.y, bee.energy]));
  });

  it('a move asked for on one tick lands MOVE_TICKS ticks later', () => {
    const world = simulate(makeWorld('move(East)'), MOVE_TICKS);
    expect(world.bees[0].x).toBe(world.hive.x);
    world.step();
    expect(world.bees[0].x).toBe(world.hive.x + 1);
  });

  it('bumping into the edge returns False', () => {
    const world = simulate(makeWorld('ok = True\nwhile ok:\n    ok = move(North)\nprint("stopped at", get_pos())'), 200);
    expect(printed(world)).toContain('stopped at [2, 0]');
  });

  it('stops on a forager script error and says which script and line', () => {
    const world = simulate(makeWorld('x = 1\nmove(Up)'), 5);
    expect(world.error).toMatchObject({ line: 2, file: 'forager' });
    expect(world.log.some(l => l.tone === 'error')).toBe(true);
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
      expect(world.over).toBeNull();
      expect(world.bees.length).toBeGreaterThan(0);
      expect(world.totalHoney).toBeGreaterThan(200);
      expect(world.comb).toBeGreaterThan(START_COMB);
    });
  }

  it('a queen who lays whenever she can starves the colony in its first winter', () => {
    const world = simulate(makeWorld(DEFAULT_FORAGER, GREEDY_QUEEN), year);
    expect(world.over).not.toBeNull();
    expect(world.fallen.some(b => b.death?.cause === 'starved')).toBe(true);
  });
});

describe('the queen, eggs and comb', () => {
  it('lay() costs honey, takes a cell, and the egg hatches later', () => {
    const world = makeWorld('while True:\n    wait(100)', 'lay()\nwait(3000)', BEE_COST);
    world.step();
    expect(world.honey).toBe(0);
    expect(world.eggs.length).toBe(1);
    expect(world.space).toBe(START_COMB - START_BEES - 1);
    simulate(world, HATCH_TICKS);
    expect(world.eggs.length).toBe(0);
    expect(world.bees.length).toBe(START_BEES + 1);
  });

  it('lay() fails without honey or without free comb', () => {
    const poor = simulate(makeWorld('wait(100)', 'print(lay())', BEE_COST - 1), LAY_TICKS + 2);
    expect(printed(poor)).toContain('False');
    const full = makeWorld('wait(100)', 'print(lay())', 1000);
    full.comb = START_BEES;
    simulate(full, LAY_TICKS + 2);
    expect(printed(full)).toContain('False');
  });

  it('the queen waits LAY_TICKS between eggs', () => {
    const world = simulate(makeWorld('wait(1000)', GREEDY_QUEEN, 1000), LAY_TICKS * 3);
    expect(world.queen!.laid).toBe(3);
  });

  it('build() at the hive turns honey into one more cell of comb', () => {
    // honey for two cells, but the second try is away from the hive
    const world = simulate(makeWorld('print(build())\nmove(East)\nprint(build())', IDLE_QUEEN, BUILD_COST * 2), 200);
    expect(printed(world).filter(t => t === 'True' || t === 'False')).toEqual(['True', 'False']);
    expect(world.comb).toBe(START_COMB + 1);
    expect(world.honey).toBe(BUILD_COST);
  });
});

describe('one bee per tile', () => {
  it('never lets two bees share a tile outside the hive', () => {
    const world = makeWorld(DEFAULT_FORAGER, DEFAULT_QUEEN);
    for (let i = 0; i < 6000; i++) {
      world.step();
      const tiles = world.bees.filter(b => !world.atHive(b)).map(b => `${b.x},${b.y}`);
      expect(new Set(tiles).size).toBe(tiles.length);
    }
  });

  it('move() into an occupied tile returns False', () => {
    const world = makeWorld('if get_pos() == [4, 6]:\n    wait(500)\nelse:\n    print(move(East), move(East), get_pos())', IDLE_QUEEN, 0, 1, 2);
    world.bees[1].x = 4;
    simulate(world, 60);
    expect(printed(world)).toContain('True False [3, 6]');
  });

  it('move_to() steers around a bee in the way', () => {
    const world = makeWorld('if get_pos() == [4, 6]:\n    wait(500)\nelse:\n    print(move_to([6, 6]), get_pos())', IDLE_QUEEN, 0, 1, 2);
    world.bees[1].x = 4;
    simulate(world, 120);
    expect(printed(world)).toContain('True [6, 6]');
  });

  it('two bees flying head-on pass each other', () => {
    const src = 'if get_pos()[0] < 5:\n    ok = move_to([8, 3])\nelse:\n    ok = move_to([3, 3])\nprint(ok, get_pos())';
    const world = makeWorld(src, IDLE_QUEEN, 0, 1, 2);
    Object.assign(world.bees[0], { x: 3, y: 3 });
    Object.assign(world.bees[1], { x: 8, y: 3 });
    simulate(world, 200);
    expect(printed(world).sort()).toEqual(['True [3, 3]', 'True [8, 3]']);
  });

  it('move_to() gives up and returns False when the spot stays taken', () => {
    const world = makeWorld('if get_pos() == [4, 6]:\n    wait(500)\nelse:\n    print(move_to([4, 6]), get_pos())', IDLE_QUEEN, 0, 1, 2);
    world.bees[1].x = 4;
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
    Object.assign(world.bees[1], { x: 4, y: 9 });
    simulate(world, 3);
    expect(printed(world)[0]).toBe('[5, 9]');
  });
});

describe('energy, food and old age', () => {
  it('bees that never eat starve, and the colony dies out', () => {
    const world = simulate(makeWorld('while True:\n    move(East)\n    move(West)'), 2000);
    expect(world.fallen.map(b => b.death?.cause)).toEqual(['starved']);
    expect(world.log.some(l => l.text.startsWith('Starved at'))).toBe(true);
    expect(world.over).not.toBeNull();
  });

  it('eating at the hive turns honey into energy', () => {
    const src = 'for i in range(15):\n    move(East)\nfor i in range(15):\n    move(West)\nate = eat()\nprint(ate, energy())';
    const world = simulate(makeWorld(src, IDLE_QUEEN, 5), 400);
    expect(printed(world)).toContain(`1 ${MAX_ENERGY}`);
    expect(world.honey).toBe(4);
  });

  it('eating away from the hive does nothing', () => {
    const world = simulate(makeWorld('move(East)\nprint(eat())', IDLE_QUEEN, 5), 100);
    expect(printed(world)).toContain('0');
    expect(world.honey).toBe(5);
  });

  it('well-fed bees still die of old age', () => {
    const world = simulate(makeWorld('while True:\n    eat()', IDLE_QUEEN, 1000), LIFESPAN_MAX + 1);
    const first = world.fallen.find(b => b.id === 1);
    expect(first?.death?.cause).toBe('old age');
    expect(first!.age).toBe(first!.lifespan);
  });
});

describe('die()', () => {
  it('ends the bee at once, frees its cell of comb, and stops its script', () => {
    const world = makeWorld('move(East)\ndie()\nprint("still here")', IDLE_QUEEN, 0, 1, 2);
    const space = world.space;
    simulate(world, MOVE_TICKS + 2);
    expect(world.bees).toEqual([]);
    expect(world.fallen.map(b => b.death?.cause)).toEqual(['by choice', 'by choice']);
    expect(world.space).toBe(space + 2);
    expect(printed(world)).toEqual([]);
    expect(world.log.some(l => l.text.startsWith('Gave its life'))).toBe(true);
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
    const before = world.bees[0].age;
    simulate(world, 100);
    expect(world.bees[0].age - before).toBe(50);
  });
});

describe('scent', () => {
  it('mark() scents the tile the bee is on, and it fades evenly to nothing', () => {
    const world = simulate(makeWorld('move(East)\nmark("food")'), MOVE_TICKS + MARK_TICKS + 2);
    const { x, y } = { x: world.hive.x + 1, y: world.hive.y };
    expect(world.scentAt(x, y, 'food')).toBe(SCENT_MAX);
    expect(world.scentAt(x, y, 'danger')).toBe(0);
    simulate(world, SCENT_LIFE / 2);
    expect(world.scentAt(x, y, 'food')).toBeGreaterThan(SCENT_MAX / 2 - 3);
    expect(world.scentAt(x, y, 'food')).toBeLessThanOrEqual(SCENT_MAX / 2 + 1);
    simulate(world, SCENT_LIFE / 2 + 60);
    expect(world.scentAt(x, y, 'food')).toBe(0);
    expect(world.scents.size).toBe(0); // faded marks are forgotten
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
