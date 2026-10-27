import { ScriptError } from '../lang/errors';
import { parse } from '../lang/parser';
import { DEFAULT_WASP } from '../defaultScript';
import { MAX_ROLES, RESERVED_NAMES, ROLE_NAME, SHARED_LINE_BASE, type Programs, type ScriptFile } from './world';

/** A colony's script files as text: the fixed files, and custom roles in the order they were made. */
export interface ScriptSet {
  forager: string;
  queen: string;
  shared: string;
  roles: [string, string][];
  wasp?: string; // sets saved before wasps existed have none: they get the default
}

export interface ScriptProblem {
  file: ScriptFile;
  line: number;
  message: string;
}

/** Whether a name can be a script file: one of the fixed files, or a valid role name. */
export function isScriptFile(file: string): boolean {
  return RESERVED_NAMES.includes(file) || ROLE_NAME.test(file);
}

/**
 * Parses every file, with shared.bee numbered from SHARED_LINE_BASE so its lines can't be
 * mistaken for a role's own (see locate()). Stops at the first file that doesn't parse.
 */
export function parseScripts(set: ScriptSet): { programs: Programs } | { problem: ScriptProblem } {
  if (set.roles.length > MAX_ROLES) return { problem: { file: set.roles.at(-1)![0], line: 1, message: `A colony can have up to ${MAX_ROLES} roles besides forager.` } };
  const files: [ScriptFile, string][] = [['forager', set.forager], ...set.roles, ['wasp', set.wasp ?? DEFAULT_WASP], ['shared', set.shared], ['queen', set.queen]];
  const parsed: Record<ScriptFile, Programs['forager']> = {};
  for (const [file, code] of files) {
    const base = file === 'shared' ? SHARED_LINE_BASE : 0;
    try {
      parsed[file] = parse(code, base + 1);
    } catch (e) {
      if (!(e instanceof ScriptError)) throw e;
      return { problem: { file, line: e.line - base, message: e.message } };
    }
  }
  return {
    programs: {
      forager: parsed.forager,
      queen: parsed.queen,
      shared: parsed.shared,
      wasp: parsed.wasp,
      roles: Object.fromEntries(set.roles.map(([name]) => [name, parsed[name]])),
    },
  };
}
