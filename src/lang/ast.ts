// Syntax tree for the bee scripting language, a small Python-like language.
// Every node carries the source line so errors and the "current line" highlight can point at it.

export type BinOp = '+' | '-' | '*' | '/' | '//' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not in';
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=';

export type Expr =
  | { kind: 'num'; value: number; line: number }
  | { kind: 'str'; value: string; line: number }
  | { kind: 'bool'; value: boolean; line: number }
  | { kind: 'none'; line: number }
  | { kind: 'name'; name: string; line: number }
  | { kind: 'list'; items: Expr[]; line: number }
  | { kind: 'index'; target: Expr; index: Expr; line: number }
  | { kind: 'call'; callee: Expr; args: Expr[]; line: number }
  | { kind: 'unary'; op: '-' | 'not'; operand: Expr; line: number }
  | { kind: 'binary'; op: BinOp; left: Expr; right: Expr; line: number }
  | { kind: 'logic'; op: 'and' | 'or'; left: Expr; right: Expr; line: number };

export type Stmt =
  | { kind: 'expr'; expr: Expr; line: number }
  | { kind: 'assign'; target: string; op: AssignOp; value: Expr; line: number }
  | { kind: 'if'; branches: { test: Expr; body: Stmt[] }[]; orelse: Stmt[] | null; line: number }
  | { kind: 'while'; test: Expr; body: Stmt[]; line: number }
  | { kind: 'for'; name: string; iter: Expr; body: Stmt[]; line: number }
  | { kind: 'def'; name: string; params: string[]; body: Stmt[]; line: number }
  | { kind: 'return'; value: Expr | null; line: number }
  | { kind: 'break'; line: number }
  | { kind: 'continue'; line: number }
  | { kind: 'pass'; line: number };
