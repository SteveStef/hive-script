import { ScriptError } from './errors';

export type TokenKind = 'num' | 'str' | 'name' | 'kw' | 'op' | 'newline' | 'indent' | 'dedent' | 'eof';
export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

export const KEYWORDS = new Set([
  'if', 'elif', 'else', 'while', 'for', 'in', 'def', 'return', 'break', 'continue', 'pass',
  'and', 'or', 'not', 'True', 'False', 'None',
]);

// Longest first, so "//=" wins over "//" and "/".
const OPERATORS = ['//=', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '+', '-', '*', '/', '%', '<', '>', '=', '(', ')', '[', ']', ',', ':'];

/**
 * Turns source text into tokens, Python style: indentation becomes INDENT/DEDENT tokens,
 * and line breaks inside brackets are ignored so long lists can span lines.
 */
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  const indents = [0];
  let brackets = 0;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const line = i + 1;
    let col = 0;

    if (brackets === 0) {
      let width = 0;
      while (col < text.length && (text[col] === ' ' || text[col] === '\t')) {
        width += text[col] === '\t' ? 4 : 1;
        col++;
      }
      if (col === text.length || text[col] === '#') continue; // blank or comment-only line
      const top = indents[indents.length - 1];
      if (width > top) {
        indents.push(width);
        tokens.push({ kind: 'indent', value: '', line });
      } else if (width < top) {
        while (width < indents[indents.length - 1]) {
          indents.pop();
          tokens.push({ kind: 'dedent', value: '', line });
        }
        if (width !== indents[indents.length - 1]) {
          throw new ScriptError("This line's indentation doesn't line up with any line above it.", line);
        }
      }
    }

    const before = tokens.length;
    while (col < text.length) {
      const ch = text[col];
      if (ch === ' ' || ch === '\t') { col++; continue; }
      if (ch === '#') break;
      const rest = text.slice(col);

      const num = /^(\d+\.\d*|\.\d+|\d+)/.exec(rest);
      if (num) {
        tokens.push({ kind: 'num', value: num[0], line });
        col += num[0].length;
        continue;
      }
      const word = /^[A-Za-z_]\w*/.exec(rest);
      if (word) {
        tokens.push({ kind: KEYWORDS.has(word[0]) ? 'kw' : 'name', value: word[0], line });
        col += word[0].length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const [value, length] = readString(text, col, line);
        tokens.push({ kind: 'str', value, line });
        col += length;
        continue;
      }
      const op = OPERATORS.find(o => rest.startsWith(o));
      if (op) {
        if (op === '(' || op === '[') brackets++;
        if (op === ')' || op === ']') brackets = Math.max(0, brackets - 1);
        tokens.push({ kind: 'op', value: op, line });
        col += op.length;
        continue;
      }
      throw new ScriptError(`I don't understand the character "${ch}".`, line);
    }
    if (brackets === 0 && tokens.length > before) tokens.push({ kind: 'newline', value: '', line });
  }

  const end = lines.length;
  if (brackets > 0) throw new ScriptError('A bracket was opened but never closed.', end);
  while (indents.length > 1) {
    indents.pop();
    tokens.push({ kind: 'dedent', value: '', line: end });
  }
  tokens.push({ kind: 'eof', value: '', line: end });
  return tokens;
}

function readString(text: string, start: number, line: number): [string, number] {
  const quote = text[start];
  let out = '';
  for (let i = start + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      const n = text[++i];
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
    } else if (c === quote) {
      return [out, i + 1 - start];
    } else {
      out += c;
    }
  }
  throw new ScriptError('This text is missing its closing quote.', line);
}
