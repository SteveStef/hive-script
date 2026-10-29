import type { BinOp, Expr, Stmt } from './ast';
import { ScriptError } from './errors';

// ---- values ----

export type Value = number | string | boolean | null | Value[] | Callable;
export type Callable = UserFunction | Builtin;

export interface UserFunction {
  kind: 'function';
  name: string;
  params: string[];
  body: Stmt[];
  closure: Scope;
}

/** A request for the game to do something that takes time, like flying one tile. */
export interface ActionRequest {
  action: string;
  args: Value[];
}

/** Named arguments a call passed (name=value), in the order written. */
export type Named = Record<string, Value>;

/** A built-in either answers right away or asks the game to perform an action. */
export interface Builtin {
  kind: 'builtin';
  name: string;
  /** The named arguments it takes, if any; a call passing any other name is a mistake. */
  named?: string[];
  call: (args: Value[], line: number, named: Named) => Value | ActionRequest;
}

export class Scope {
  private readonly vars = new Map<string, Value>();
  constructor(private readonly parent: Scope | null) {}

  get(name: string, line: number): Value {
    for (let s: Scope | null = this; s; s = s.parent) {
      if (s.vars.has(name)) return s.vars.get(name)!;
    }
    throw new ScriptError(`"${name}" hasn't been given a value yet.`, line);
  }

  set(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  entries(): [string, Value][] {
    return [...this.vars.entries()];
  }
}

// ---- running a script ----

/** What the script hands back to the runner each time it pauses. */
type Pause = { type: 'op'; line: number } | { type: 'action'; action: string; args: Value[]; line: number };

export type RunResult =
  | { type: 'action'; action: string; args: Value[] }
  | { type: 'budget' }
  | { type: 'done' }
  | { type: 'error'; error: ScriptError };

const MAX_CALL_DEPTH = 64;

/**
 * Runs one bee's copy of a script. The script is a generator that pauses after every
 * statement, so the game can give each bee a fixed number of operations per tick (an
 * infinite loop just keeps the bee thinking instead of freezing the game), and pauses
 * on every action until the game reports the action's result.
 */
export class Runner {
  line = 0;
  finished = false;
  error: ScriptError | null = null;
  private readonly gen: Generator<Pause, void, Value>;
  private readonly scope = new Scope(null);
  private readonly builtinNames: Set<string>;
  private input: Value = null;

  constructor(program: Stmt[], globals: Record<string, Value>) {
    for (const [name, value] of Object.entries(globals)) this.scope.set(name, value);
    this.builtinNames = new Set(Object.keys(globals));
    this.gen = execBlock(program, this.scope, 0);
  }

  /** The script's own top-level variables (not built-ins or functions), for the inspector. */
  variables(): [string, Value][] {
    return this.scope.entries().filter(([name, value]) => !this.builtinNames.has(name) && !isCallable(value));
  }

  /** Runs until the script asks for an action, ends, fails, or spends `budget` operations. */
  run(budget: number): RunResult {
    if (this.finished) return this.error ? { type: 'error', error: this.error } : { type: 'done' };
    for (let spent = 0; spent < budget; spent++) {
      let step: IteratorResult<Pause, void>;
      try {
        step = this.gen.next(this.input);
      } catch (e) {
        this.finished = true;
        this.error = e instanceof ScriptError ? e : new ScriptError(String(e instanceof Error ? e.message : e), this.line);
        return { type: 'error', error: this.error };
      }
      this.input = null;
      if (step.done) {
        this.finished = true;
        return { type: 'done' };
      }
      this.line = step.value.line;
      if (step.value.type === 'action') return { type: 'action', action: step.value.action, args: step.value.args };
    }
    return { type: 'budget' };
  }

  /** Hands the result of the last action back to the script; it sees it on the next run(). */
  resume(value: Value): void {
    this.input = value;
  }
}

// Control flow travels through the generators as thrown signals.
class BreakSignal {}
class ContinueSignal {}
class ReturnSignal {
  constructor(public readonly value: Value) {}
}

function* execBlock(body: Stmt[], scope: Scope, depth: number): Generator<Pause, void, Value> {
  for (const s of body) yield* execStmt(s, scope, depth);
}

function* execStmt(s: Stmt, scope: Scope, depth: number): Generator<Pause, void, Value> {
  yield { type: 'op', line: s.line };
  switch (s.kind) {
    case 'expr':
      yield* evaluate(s.expr, scope, depth);
      return;
    case 'assign': {
      let value = yield* evaluate(s.value, scope, depth);
      if (s.op !== '=') value = binop(s.op.slice(0, -1) as BinOp, scope.get(s.target, s.line), value, s.line);
      scope.set(s.target, value);
      return;
    }
    case 'if':
      for (const branch of s.branches) {
        if (truthy(yield* evaluate(branch.test, scope, depth))) {
          yield* execBlock(branch.body, scope, depth);
          return;
        }
      }
      if (s.orelse) yield* execBlock(s.orelse, scope, depth);
      return;
    case 'while':
      while (truthy(yield* evaluate(s.test, scope, depth))) {
        if (yield* loopBody(s.body, scope, depth)) break;
        yield { type: 'op', line: s.line };
      }
      return;
    case 'for': {
      const items = yield* evaluate(s.iter, scope, depth);
      if (!Array.isArray(items) && typeof items !== 'string') {
        throw new ScriptError(`A for loop needs a list or range(), not ${typeName(items)}.`, s.line);
      }
      for (const item of Array.from(items)) {
        scope.set(s.name, item);
        if (yield* loopBody(s.body, scope, depth)) break;
      }
      return;
    }
    case 'def':
      scope.set(s.name, { kind: 'function', name: s.name, params: s.params, body: s.body, closure: scope });
      return;
    case 'return':
      throw new ReturnSignal(s.value ? yield* evaluate(s.value, scope, depth) : null);
    case 'break':
      throw new BreakSignal();
    case 'continue':
      throw new ContinueSignal();
    case 'pass':
      return;
  }
}

/** Runs one pass of a loop body; returns true if the loop should stop (break). */
function* loopBody(body: Stmt[], scope: Scope, depth: number): Generator<Pause, boolean, Value> {
  try {
    yield* execBlock(body, scope, depth);
  } catch (e) {
    if (e instanceof BreakSignal) return true;
    if (!(e instanceof ContinueSignal)) throw e;
  }
  return false;
}

function* evaluate(e: Expr, scope: Scope, depth: number): Generator<Pause, Value, Value> {
  switch (e.kind) {
    case 'num':
    case 'str':
    case 'bool':
      return e.value;
    case 'none':
      return null;
    case 'name':
      return scope.get(e.name, e.line);
    case 'list': {
      const out: Value[] = [];
      for (const item of e.items) out.push(yield* evaluate(item, scope, depth));
      return out;
    }
    case 'index': {
      const target = yield* evaluate(e.target, scope, depth);
      const index = yield* evaluate(e.index, scope, depth);
      if (!Array.isArray(target) && typeof target !== 'string') throw new ScriptError(`You can't index into ${typeName(target)}.`, e.line);
      if (typeof index !== 'number' || !Number.isInteger(index)) throw new ScriptError('A list index must be a whole number.', e.line);
      const i = index < 0 ? target.length + index : index;
      if (i < 0 || i >= target.length) throw new ScriptError(`Index ${index} is out of range for a length of ${target.length}.`, e.line);
      return target[i];
    }
    case 'unary': {
      const v = yield* evaluate(e.operand, scope, depth);
      if (e.op === 'not') return !truthy(v);
      if (typeof v !== 'number') throw new ScriptError(`You can't make ${typeName(v)} negative.`, e.line);
      return -v;
    }
    case 'logic': {
      const left = yield* evaluate(e.left, scope, depth);
      if (e.op === 'and' ? !truthy(left) : truthy(left)) return left;
      return yield* evaluate(e.right, scope, depth);
    }
    case 'binary': {
      const left = yield* evaluate(e.left, scope, depth);
      const right = yield* evaluate(e.right, scope, depth);
      return binop(e.op, left, right, e.line);
    }
    case 'call': {
      const callee = yield* evaluate(e.callee, scope, depth);
      const args: Value[] = [];
      for (const a of e.args) args.push(yield* evaluate(a, scope, depth));
      const named: Named = Object.create(null); // no inherited keys, so a parameter called toString can't match one
      for (const n of e.named) named[n.name] = yield* evaluate(n.value, scope, depth);
      return yield* call(callee, args, named, e.line, depth);
    }
  }
}

function* call(callee: Value, args: Value[], named: Named, line: number, depth: number): Generator<Pause, Value, Value> {
  const names = Object.keys(named);
  if (isCallable(callee) && callee.kind === 'builtin') {
    const wrong = names.find(n => !callee.named?.includes(n));
    if (wrong !== undefined) {
      throw new ScriptError(
        callee.named?.length
          ? `${callee.name}() takes ${callee.named.map(n => `${n}=`).join(', ')}, not ${wrong}=.`
          : `${callee.name}() doesn't take named values like ${wrong}=.`,
        line,
      );
    }
    const result = callee.call(args, line, named);
    if (isAction(result)) {
      const answer = yield { type: 'action', action: result.action, args: result.args, line };
      return answer ?? null;
    }
    return result;
  }
  if (isCallable(callee)) {
    if (!names.length && args.length !== callee.params.length) {
      throw new ScriptError(`${callee.name}() takes ${callee.params.length} argument(s) but got ${args.length}.`, line);
    }
    if (args.length > callee.params.length) {
      throw new ScriptError(`${callee.name}() takes ${callee.params.length} argument(s) but got ${args.length} plain values.`, line);
    }
    // named values fill the parameters of the same name, after the plain ones fill the first few
    for (const n of names) {
      const at = callee.params.indexOf(n);
      if (at < 0) throw new ScriptError(`${callee.name}() has no parameter called "${n}".`, line);
      if (at < args.length) throw new ScriptError(`"${n}" is given twice: once in order, once by name.`, line);
    }
    const missing = callee.params.find((p, i) => i >= args.length && !(p in named));
    if (missing !== undefined) throw new ScriptError(`${callee.name}() needs a value for "${missing}".`, line);
    if (depth >= MAX_CALL_DEPTH) throw new ScriptError('Too many functions calling each other (more than 64 deep).', line);
    const local = new Scope(callee.closure);
    callee.params.forEach((p, i) => local.set(p, i < args.length ? args[i] : named[p]));
    try {
      yield* execBlock(callee.body, local, depth + 1);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
    return null;
  }
  throw new ScriptError(`${format(callee, true)} is not a function, so it can't be called.`, line);
}

// ---- helpers shared with the built-ins ----

export function isCallable(v: Value): v is Callable {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'kind' in v;
}

function isAction(v: Value | ActionRequest): v is ActionRequest {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'action' in v;
}

export function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== false && v !== 0 && v !== '';
}

export function typeName(v: Value): string {
  if (v === null) return 'None';
  if (Array.isArray(v)) return 'a list';
  if (isCallable(v)) return 'a function';
  if (typeof v === 'boolean') return 'True/False';
  return typeof v === 'number' ? 'a number' : 'text';
}

function equal(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
}

function binop(op: BinOp, a: Value, b: Value, line: number): Value {
  switch (op) {
    case '==':
      return equal(a, b);
    case '!=':
      return !equal(a, b);
    case 'in':
    case 'not in': {
      let found: boolean;
      if (Array.isArray(b)) found = b.some(x => equal(x, a));
      else if (typeof b === 'string' && typeof a === 'string') found = b.includes(a);
      else throw new ScriptError(`"${op}" needs a list or text on its right, not ${typeName(b)}.`, line);
      return op === 'in' ? found : !found;
    }
    case '+':
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (typeof a === 'string' && typeof b === 'string') return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      break;
    case '-':
    case '*':
    case '/':
    case '//':
    case '%':
      if (typeof a === 'number' && typeof b === 'number') {
        if (op !== '-' && op !== '*' && b === 0) throw new ScriptError("You can't divide by zero.", line);
        if (op === '-') return a - b;
        if (op === '*') return a * b;
        if (op === '/') return a / b;
        if (op === '//') return Math.floor(a / b);
        return ((a % b) + b) % b; // Python-style: the result takes the sign of b
      }
      if (op === '*' && typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, Math.floor(b)));
      break;
    default:
      if ((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string')) {
        if (op === '<') return a < b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        return a >= b;
      }
  }
  throw new ScriptError(`You can't use ${op} with ${typeName(a)} and ${typeName(b)}.`, line);
}

/** Formats a value the way print() shows it. Text inside lists is quoted. */
export function format(v: Value, nested = false): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
  if (typeof v === 'string') return nested ? JSON.stringify(v) : v;
  if (Array.isArray(v)) return '[' + v.map(x => format(x, true)).join(', ') + ']';
  return `<function ${v.name}>`;
}
