import { describe, expect, it } from 'vitest';
import { API_DOCS } from '../src/sim/apiDocs';
import { parseScripts } from '../src/sim/scripts';
import { lessonSet, LESSONS, type Lesson } from '../src/tutorial/lessons';
import type { World } from '../src/sim/world';

/** Runs a lesson's starter or solution; returns the world and which goals were met, latched as the tutorial does. */
function play(lesson: Lesson, which: 'starter' | 'solution', ticks: number): { world: World; met: boolean[] } {
  const parsed = parseScripts(lessonSet(lesson, which));
  if (!('programs' in parsed)) throw new Error(`${lesson.id} ${which}: ${parsed.problem.file}.bee line ${parsed.problem.line}: ${parsed.problem.message}`);
  const world = lesson.world(parsed.programs);
  const met = lesson.goals.map(() => false);
  for (let t = 0; t < ticks && world.running && !met.every(Boolean); t++) {
    world.step();
    lesson.goals.forEach((g, i) => (met[i] ||= g.check(world)));
  }
  return { world, met };
}

describe('tutorial lessons', () => {
  it('have unique ids, and only name functions that exist', () => {
    expect(new Set(LESSONS.map(l => l.id)).size).toBe(LESSONS.length);
    const real = new Set(API_DOCS.map(d => d.name));
    for (const l of LESSONS) {
      const named = [...l.intro.matchAll(/docs\.html#(\w+)/g)].map(m => m[1]);
      expect(named.filter(n => !real.has(n)), l.id).toEqual([]);
    }
  });

  for (const lesson of LESSONS) {
    it(`${lesson.id}: the solution meets every goal within ${lesson.budget} ticks`, () => {
      const { world, met } = play(lesson, 'solution', lesson.budget);
      expect(world.error, JSON.stringify(world.error)).toBeNull();
      expect(met).toEqual(lesson.goals.map(() => true));
    });
    it(`${lesson.id}: the starter doesn't, and runs without an error`, () => {
      const { world, met } = play(lesson, 'starter', lesson.budget);
      expect(met.every(Boolean)).toBe(false);
      expect(world.error, JSON.stringify(world.error)).toBeNull();
    });
  }
});
