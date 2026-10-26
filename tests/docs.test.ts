import { describe, expect, it } from 'vitest';
import { demoOptions, DOCS } from '../src/docs/entries';
import { coreBuiltins } from '../src/lang/builtins';
import { Runner } from '../src/lang/interpreter';
import { parse } from '../src/lang/parser';
import { API_DOCS } from '../src/sim/apiDocs';
import { World } from '../src/sim/world';

const IDLE = 'while True:\n    wait(1000)';
const covered = new Set(Object.entries(DOCS).flatMap(([name, entry]) => [name, ...(entry.covers ?? [])]));

describe('docs page', () => {
  it('has a card for every function scripts can call', () => {
    const missing = API_DOCS.map(d => d.name).filter(name => !covered.has(name));
    expect(missing).toEqual([]);
  });

  it('only documents functions that exist', () => {
    const real = new Set(API_DOCS.map(d => d.name));
    expect([...covered].filter(name => !real.has(name))).toEqual([]);
  });

  for (const [name, entry] of Object.entries(DOCS)) {
    if (entry.demo) {
      it(`the ${name} clip runs without errors`, () => {
        const d = entry.demo!;
        const world = new World({ forager: parse(d.forager ?? IDLE), queen: parse(d.queen ?? IDLE) }, 1, demoOptions(d));
        for (let i = 0; i < (d.length ?? 600); i++) world.step();
        expect(world.error).toBeNull();
        expect(world.over).toBeNull();
      });
    } else {
      it(`the ${name} example runs`, () => {
        const out: string[] = [];
        const result = new Runner(parse(entry.example!), coreBuiltins(t => out.push(t))).run(10_000);
        expect(result.type).toBe('done');
        expect(out.length).toBeGreaterThan(0);
      });
    }
  }
});
