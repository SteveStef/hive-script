import { ScriptError } from './errors';
import { format, type Builtin, type Value } from './interpreter';

const MAX_RANGE = 10_000;

export function builtin(name: string, call: Builtin['call']): Builtin {
  return { kind: 'builtin', name, call };
}

export function expectArgs(name: string, args: Value[], count: number, line: number): void {
  if (args.length !== count) {
    throw new ScriptError(`${name}() takes ${count} argument${count === 1 ? '' : 's'} but got ${args.length}.`, line);
  }
}

export function expectNumber(name: string, v: Value, line: number): number {
  if (typeof v !== 'number') throw new ScriptError(`${name}() needs a number here.`, line);
  return v;
}

/** General-purpose built-ins every script gets, independent of the game. */
export function coreBuiltins(print: (text: string) => void): Record<string, Value> {
  return {
    print: builtin('print', args => {
      print(args.map(a => format(a)).join(' '));
      return null;
    }),
    range: builtin('range', (args, line) => {
      if (args.length < 1 || args.length > 3) throw new ScriptError('range() takes 1 to 3 numbers.', line);
      const n = args.map(a => expectNumber('range', a, line));
      const [start, stop, step] = n.length === 1 ? [0, n[0], 1] : [n[0], n[1], n[2] ?? 1];
      if (step === 0) throw new ScriptError("range()'s step can't be zero.", line);
      const out: number[] = [];
      for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
        if (out.length >= MAX_RANGE) throw new ScriptError(`range() is limited to ${MAX_RANGE.toLocaleString('en-US')} numbers.`, line);
        out.push(i);
      }
      return out;
    }),
    len: builtin('len', (args, line) => {
      expectArgs('len', args, 1, line);
      const v = args[0];
      if (!Array.isArray(v) && typeof v !== 'string') throw new ScriptError('len() needs a list or text.', line);
      return v.length;
    }),
    abs: builtin('abs', (args, line) => {
      expectArgs('abs', args, 1, line);
      return Math.abs(expectNumber('abs', args[0], line));
    }),
    min: builtin('min', (args, line) => extreme('min', args, line, (a, b) => a < b)),
    max: builtin('max', (args, line) => extreme('max', args, line, (a, b) => a > b)),
    str: builtin('str', (args, line) => {
      expectArgs('str', args, 1, line);
      return format(args[0]);
    }),
    distance: builtin('distance', (args, line) => {
      expectArgs('distance', args, 2, line);
      const [a, b] = args.map(v => {
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return v as number[];
        throw new ScriptError(`distance() needs two positions like [3, 5], not ${format(v, true)}.`, line);
      });
      return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    }),
    int: builtin('int', (args, line) => {
      expectArgs('int', args, 1, line);
      const v = args[0];
      if (typeof v === 'number') return Math.trunc(v);
      if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
      throw new ScriptError(`int() can't turn ${format(v, true)} into a whole number.`, line);
    }),
  };
}

function extreme(name: string, args: Value[], line: number, better: (a: number, b: number) => boolean): number {
  const items = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  if (items.length === 0) throw new ScriptError(`${name}() needs at least one number.`, line);
  let best = expectNumber(name, items[0], line);
  for (const v of items.slice(1)) {
    const n = expectNumber(name, v, line);
    if (better(n, best)) best = n;
  }
  return best;
}
