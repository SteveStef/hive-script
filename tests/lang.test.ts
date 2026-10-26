import { describe, expect, it } from 'vitest';
import { builtin, coreBuiltins } from '../src/lang/builtins';
import { ScriptError } from '../src/lang/errors';
import { Runner, type Value } from '../src/lang/interpreter';
import { parse } from '../src/lang/parser';

function run(source: string, extra: Record<string, Value> = {}) {
  const out: string[] = [];
  const runner = new Runner(parse(source), { ...coreBuiltins(t => out.push(t)), ...extra });
  const result = runner.run(100_000);
  return { out, result, runner };
}

function parseError(source: string): ScriptError {
  try {
    parse(source);
  } catch (e) {
    if (e instanceof ScriptError) return e;
    throw e;
  }
  throw new Error('expected a parse error');
}

describe('expressions', () => {
  it('does arithmetic with Python rules', () => {
    expect(run('print(1 + 2 * 3, 7 // 2, -7 % 3, 2 / 4)').out).toEqual(['7 3 2 0.5']);
  });

  it('compares, combines and short-circuits', () => {
    expect(run('print(3 > 2 and not False, None or 5, 0 and boom)').out).toEqual(['True 5 0']);
  });

  it('checks membership with in and not in', () => {
    expect(run('s = "summer"\nprint(s in ["spring", "summer"], s not in ["winter"], [1, 2] in [[1, 2]], "um" in s)').out).toEqual(['True True True True']);
  });

  it('builds and indexes lists, including (x, y) pairs', () => {
    expect(run('p = (3, 4)\nxs = [1, 2] + [p]\nprint(xs, xs[-1][1], len(xs))').out).toEqual(['[1, 2, [3, 4]] 4 3']);
  });
});

describe('statements', () => {
  it('runs if / elif / else', () => {
    const src = 'for n in [1, 5, 9]:\n    if n < 3:\n        print("low")\n    elif n < 7:\n        print("mid")\n    else:\n        print("high")';
    expect(run(src).out).toEqual(['low', 'mid', 'high']);
  });

  it('runs while loops with break and continue', () => {
    const src = 'i = 0\nwhile True:\n    i += 1\n    if i == 2:\n        continue\n    if i > 4:\n        break\n    print(i)';
    expect(run(src).out).toEqual(['1', '3', '4']);
  });

  it('supports functions, return values and recursion', () => {
    const src = 'def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\nprint(fib(10))';
    expect(run(src).out).toEqual(['55']);
  });

  it('allows one-line blocks', () => {
    expect(run('if True: print("yes")').out).toEqual(['yes']);
  });
});

describe('pausing for the game', () => {
  const collect = builtin('collect', () => ({ action: 'collect', args: [] }));

  it('stops at an action and continues with its result', () => {
    const out: string[] = [];
    const runner = new Runner(parse('got = collect()\nprint(got)'), { ...coreBuiltins(t => out.push(t)), collect });
    expect(runner.run(100)).toEqual({ type: 'action', action: 'collect', args: [] });
    expect(runner.line).toBe(1);
    runner.resume(true);
    expect(runner.run(100)).toEqual({ type: 'done' });
    expect(out).toEqual(['True']);
  });

  it('keeps an infinite loop inside its budget instead of hanging', () => {
    const runner = new Runner(parse('x = 0\nwhile True:\n    x += 1'), {});
    expect(runner.run(50)).toEqual({ type: 'budget' });
    expect(runner.run(50)).toEqual({ type: 'budget' });
    expect(runner.finished).toBe(false);
  });
});

describe('errors point at the right line', () => {
  it('reports a missing colon', () => {
    const e = parseError('x = 1\nwhile True\n    x += 1');
    expect(e.line).toBe(2);
    expect(e.message).toMatch(':');
  });

  it('reports a missing indented block', () => {
    expect(parseError('if True:\nprint(1)').line).toBe(2);
  });

  it('reports break outside a loop', () => {
    expect(parseError('x = 1\nbreak').line).toBe(2);
  });

  it('reports runtime type errors', () => {
    const { result } = run('x = 1\ny = x + "a"');
    expect(result.type).toBe('error');
    if (result.type === 'error') expect(result.error.line).toBe(2);
  });

  it('reports unknown names', () => {
    const { result } = run('\n\nmove(Up)');
    expect(result.type === 'error' && result.error.line).toBe(3);
  });
});

describe('line numbers', () => {
  it('can start from any line, so a file that runs ahead of another keeps its own numbers', () => {
    expect(parse('x = 1\n\ny = 2', 101).map(s => s.line)).toEqual([101, 103]);
    expect(() => parse('x = 1\ny = (', 101)).toThrow(ScriptError);
    let line = 0;
    try {
      parse('x = 1\ny = $', 101);
    } catch (e) {
      line = (e as ScriptError).line;
    }
    expect(line).toBe(102);
  });
});
