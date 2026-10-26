import type { AssignOp, BinOp, Expr, Stmt } from './ast';
import { ScriptError } from './errors';
import { lex, type Token, type TokenKind } from './lexer';

/** Parses a whole script. Throws a ScriptError (with a line number) on the first problem. */
export function parse(source: string): Stmt[] {
  return new Parser(lex(source)).program();
}

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=']);
const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);

class Parser {
  private pos = 0;
  private loops = 0; // how many loops enclose the current statement, for break/continue
  private functions = 0; // how many defs enclose it, for return

  constructor(private readonly tokens: Token[]) {}

  program(): Stmt[] {
    const body: Stmt[] = [];
    while (!this.at('eof')) body.push(this.statement());
    return body;
  }

  // ---- token helpers ----

  private get tok(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private at(kind: TokenKind, value?: string): boolean {
    return this.tok.kind === kind && (value === undefined || this.tok.value === value);
  }
  private accept(kind: TokenKind, value?: string): boolean {
    if (!this.at(kind, value)) return false;
    this.pos++;
    return true;
  }
  private expect(kind: TokenKind, value: string | undefined, message: string): Token {
    if (!this.at(kind, value)) throw new ScriptError(message, this.tok.line);
    return this.next();
  }
  private endLine(): void {
    if (this.accept('newline') || this.at('eof') || this.at('dedent')) return;
    throw new ScriptError(`I didn't expect "${this.tok.value}" here.`, this.tok.line);
  }

  // ---- statements ----

  private statement(): Stmt {
    const t = this.tok;
    if (t.kind === 'indent') throw new ScriptError('This line is indented, but nothing above it starts a block.', t.line);
    if (t.kind === 'kw') {
      switch (t.value) {
        case 'if':
          return this.ifStatement();
        case 'while': {
          this.next();
          const test = this.expr();
          return { kind: 'while', test, body: this.loopBody(t.line), line: t.line };
        }
        case 'for': {
          this.next();
          const name = this.expect('name', undefined, 'A for loop needs a variable name, like: for i in range(5):').value;
          this.expect('kw', 'in', 'Expected "in" after the loop variable, like: for i in range(5):');
          const iter = this.expr();
          return { kind: 'for', name, iter, body: this.loopBody(t.line), line: t.line };
        }
        case 'def':
          return this.def();
        case 'return': {
          this.next();
          if (!this.functions) throw new ScriptError('"return" can only be used inside a function.', t.line);
          const value = this.at('newline') || this.at('eof') ? null : this.expr();
          this.endLine();
          return { kind: 'return', value, line: t.line };
        }
        case 'break':
        case 'continue': {
          this.next();
          if (!this.loops) throw new ScriptError(`"${t.value}" can only be used inside a loop.`, t.line);
          this.endLine();
          return { kind: t.value as 'break' | 'continue', line: t.line };
        }
        case 'pass':
          this.next();
          this.endLine();
          return { kind: 'pass', line: t.line };
        case 'elif':
        case 'else':
          throw new ScriptError(`"${t.value}" needs an "if" directly above it, at the same indentation.`, t.line);
      }
    }
    return this.simple();
  }

  private simple(): Stmt {
    const line = this.tok.line;
    const following = this.tokens[this.pos + 1];
    if (this.at('name') && following.kind === 'op' && ASSIGN_OPS.has(following.value)) {
      const target = this.next().value;
      const op = this.next().value as AssignOp;
      const value = this.expr();
      this.endLine();
      return { kind: 'assign', target, op, value, line };
    }
    const expr = this.expr();
    if (this.at('op', '=')) throw new ScriptError('You can only assign to a plain name, like: x = 5', line);
    this.endLine();
    return { kind: 'expr', expr, line };
  }

  private ifStatement(): Stmt {
    const line = this.next().line;
    const branches = [{ test: this.expr(), body: this.block(line) }];
    let orelse: Stmt[] | null = null;
    while (this.at('kw', 'elif')) {
      const l = this.next().line;
      branches.push({ test: this.expr(), body: this.block(l) });
    }
    if (this.at('kw', 'else')) orelse = this.block(this.next().line);
    return { kind: 'if', branches, orelse, line };
  }

  private def(): Stmt {
    const line = this.next().line;
    const name = this.expect('name', undefined, 'A function needs a name, like: def go_collect():').value;
    this.expect('op', '(', `Expected "(" after the function name "${name}".`);
    const params: string[] = [];
    while (!this.at('op', ')')) {
      params.push(this.expect('name', undefined, 'Function parameters must be plain names.').value);
      if (!this.accept('op', ',')) break;
    }
    this.expect('op', ')', 'Missing ")" after the parameters.');
    const outerLoops = this.loops;
    this.loops = 0;
    this.functions++;
    const body = this.block(line);
    this.functions--;
    this.loops = outerLoops;
    return { kind: 'def', name, params, body, line };
  }

  private loopBody(line: number): Stmt[] {
    this.loops++;
    const body = this.block(line);
    this.loops--;
    return body;
  }

  /** A ":" followed by either one statement on the same line or an indented block. */
  private block(header: number): Stmt[] {
    this.expect('op', ':', 'This line needs a ":" at the end.');
    if (!this.at('newline')) return [this.statement()];
    this.next();
    if (!this.at('indent')) throw new ScriptError(`The lines after line ${header} should be indented to form its block.`, this.tok.line);
    this.next();
    const body: Stmt[] = [];
    while (!this.at('dedent') && !this.at('eof')) body.push(this.statement());
    this.accept('dedent');
    return body;
  }

  // ---- expressions, lowest precedence first ----

  private expr(): Expr {
    return this.or();
  }

  private or(): Expr {
    let left = this.and();
    while (this.at('kw', 'or')) {
      const line = this.next().line;
      left = { kind: 'logic', op: 'or', left, right: this.and(), line };
    }
    return left;
  }

  private and(): Expr {
    let left = this.not();
    while (this.at('kw', 'and')) {
      const line = this.next().line;
      left = { kind: 'logic', op: 'and', left, right: this.not(), line };
    }
    return left;
  }

  private not(): Expr {
    if (this.at('kw', 'not')) {
      const line = this.next().line;
      return { kind: 'unary', op: 'not', operand: this.not(), line };
    }
    return this.compare();
  }

  private compare(): Expr {
    let left = this.additive();
    for (;;) {
      let op: BinOp;
      const line = this.tok.line;
      if (this.at('op') && COMPARE_OPS.has(this.tok.value)) op = this.next().value as BinOp;
      else if (this.accept('kw', 'in')) op = 'in';
      else if (this.at('kw', 'not') && this.tokens[this.pos + 1].kind === 'kw' && this.tokens[this.pos + 1].value === 'in') {
        this.pos += 2;
        op = 'not in';
      } else return left;
      left = { kind: 'binary', op, left, right: this.additive(), line };
    }
  }

  private additive(): Expr {
    let left = this.term();
    while (this.at('op', '+') || this.at('op', '-')) {
      const t = this.next();
      left = { kind: 'binary', op: t.value as BinOp, left, right: this.term(), line: t.line };
    }
    return left;
  }

  private term(): Expr {
    let left = this.unary();
    while (this.at('op', '*') || this.at('op', '/') || this.at('op', '//') || this.at('op', '%')) {
      const t = this.next();
      left = { kind: 'binary', op: t.value as BinOp, left, right: this.unary(), line: t.line };
    }
    return left;
  }

  private unary(): Expr {
    if (this.at('op', '-')) {
      const line = this.next().line;
      return { kind: 'unary', op: '-', operand: this.unary(), line };
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.atom();
    for (;;) {
      if (this.at('op', '(')) {
        const line = this.next().line;
        const args = this.items(')', 'Missing ")" to close this call.');
        e = { kind: 'call', callee: e, args, line };
      } else if (this.at('op', '[')) {
        const line = this.next().line;
        const index = this.expr();
        this.expect('op', ']', 'Missing "]" after the index.');
        e = { kind: 'index', target: e, index, line };
      } else {
        return e;
      }
    }
  }

  private atom(): Expr {
    const t = this.next();
    const line = t.line;
    switch (t.kind) {
      case 'num':
        return { kind: 'num', value: Number(t.value), line };
      case 'str':
        return { kind: 'str', value: t.value, line };
      case 'name':
        return { kind: 'name', name: t.value, line };
      case 'kw':
        if (t.value === 'True' || t.value === 'False') return { kind: 'bool', value: t.value === 'True', line };
        if (t.value === 'None') return { kind: 'none', line };
        break;
      case 'op':
        if (t.value === '(') {
          const first = this.expr();
          if (this.accept('op', ',')) {
            // (x, y) is a pair; it becomes a list, so positions can be written either way
            const items = [first, ...this.items(')', 'Missing ")".')];
            return { kind: 'list', items, line };
          }
          this.expect('op', ')', 'Missing ")".');
          return first;
        }
        if (t.value === '[') return { kind: 'list', items: this.items(']', 'Missing "]" to close this list.'), line };
        break;
    }
    if (t.kind === 'newline' || t.kind === 'eof') throw new ScriptError('This line ends before the expression is finished.', line);
    throw new ScriptError(`I didn't expect "${t.value}" here.`, line);
  }

  /** Comma-separated expressions up to and including the closing bracket. */
  private items(close: string, message: string): Expr[] {
    const items: Expr[] = [];
    while (!this.at('op', close)) {
      items.push(this.expr());
      if (!this.accept('op', ',')) break;
    }
    this.expect('op', close, message);
    return items;
  }
}
