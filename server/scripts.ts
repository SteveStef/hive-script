import type { FastifyInstance } from 'fastify';
import { DEFAULT_FORAGER, DEFAULT_QUEEN, DEFAULT_SHARED, DEFAULT_WASP } from '../src/defaultScript';
import { isScriptFile, type ScriptSet } from '../src/sim/scripts';
import { MAX_ROLES, RESERVED_NAMES } from '../src/sim/world';
import { requireUser } from './auth';
import type { Sql } from './db';

export type Mode = 'single' | 'multi';
const MODES: Mode[] = ['single', 'multi'];
const MAX_CODE = 100_000; // characters in one script

interface ScriptRow {
  file: string;
  code: string;
  position: number;
}

/** A player's scripts for one mode as a ScriptSet; a player with none yet gets the defaults saved first. */
export async function loadScripts(sql: Sql, userId: number, mode: Mode): Promise<{ set: ScriptSet; fresh: boolean }> {
  let rows: ScriptRow[] = await sql<ScriptRow[]>`SELECT file, code, position FROM scripts WHERE user_id = ${userId} AND mode = ${mode} ORDER BY position, file`;
  const fresh = rows.length === 0;
  if (fresh) {
    const defaults = [['forager', DEFAULT_FORAGER], ['wasp', DEFAULT_WASP], ['shared', DEFAULT_SHARED], ['queen', DEFAULT_QUEEN]];
    for (const [file, code] of defaults) {
      await sql`INSERT INTO scripts (user_id, mode, file, code) VALUES (${userId}, ${mode}, ${file}, ${code}) ON CONFLICT DO NOTHING`;
    }
    rows = defaults.map(([file, code]) => ({ file, code, position: 0 }));
  }
  const code = (file: string) => rows.find(r => r.file === file)?.code ?? '';
  return {
    set: {
      forager: code('forager') || DEFAULT_FORAGER,
      queen: code('queen') || DEFAULT_QUEEN,
      shared: code('shared'),
      wasp: rows.some(r => r.file === 'wasp') ? code('wasp') : DEFAULT_WASP, // accounts from before wasps get the default
      roles: rows.filter(r => !RESERVED_NAMES.includes(r.file)).map(r => [r.file, r.code]),
    },
    fresh,
  };
}

export function scriptRoutes(app: FastifyInstance, sql: Sql): void {
  app.get<{ Params: { mode: string } }>('/api/scripts/:mode', async (req, reply) => {
    const user = await requireUser(sql, req, reply);
    if (!user) return;
    const mode = req.params.mode as Mode;
    if (!MODES.includes(mode)) return reply.code(404).send({ error: 'No such script set.' });
    return loadScripts(sql, user.id, mode);
  });

  app.put<{ Params: { mode: string; file: string }; Body: { code?: unknown; position?: unknown } }>('/api/scripts/:mode/:file', async (req, reply) => {
    const user = await requireUser(sql, req, reply);
    if (!user) return;
    const { mode, file } = req.params as { mode: Mode; file: string };
    const code = req.body?.code;
    if (!MODES.includes(mode) || !isScriptFile(file)) return reply.code(404).send({ error: 'No such script.' });
    if (typeof code !== 'string' || code.length > MAX_CODE) return reply.code(400).send({ error: `A script is text of up to ${MAX_CODE.toLocaleString('en-US')} characters.` });
    const position = Number.isInteger(req.body?.position) ? (req.body!.position as number) : 0;
    if (!RESERVED_NAMES.includes(file)) {
      const [{ roles }] = await sql<{ roles: number }[]>`
        SELECT count(*)::int AS roles FROM scripts
        WHERE user_id = ${user.id} AND mode = ${mode} AND file <> ALL(${RESERVED_NAMES}) AND file <> ${file}`;
      if (roles >= MAX_ROLES) return reply.code(400).send({ error: `A colony can have up to ${MAX_ROLES} roles besides forager.` });
    }
    await sql`
      INSERT INTO scripts (user_id, mode, file, code, position) VALUES (${user.id}, ${mode}, ${file}, ${code}, ${position})
      ON CONFLICT (user_id, mode, file) DO UPDATE SET code = EXCLUDED.code, updated_at = now()`;
    return { ok: true };
  });

  app.delete<{ Params: { mode: string; file: string } }>('/api/scripts/:mode/:file', async (req, reply) => {
    const user = await requireUser(sql, req, reply);
    if (!user) return;
    const { mode, file } = req.params as { mode: Mode; file: string };
    if (!MODES.includes(mode) || RESERVED_NAMES.includes(file)) return reply.code(400).send({ error: 'Only a custom role\'s script can be deleted.' });
    await sql`DELETE FROM scripts WHERE user_id = ${user.id} AND mode = ${mode} AND file = ${file}`;
    return { ok: true };
  });
}
