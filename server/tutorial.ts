import type { FastifyInstance } from 'fastify';
import { LESSONS } from '../src/tutorial/lessons';
import { requireUser } from './auth';
import type { Sql } from './db';

const IDS = new Set(LESSONS.map(l => l.id));

/** Which tutorial lessons a player has finished, for the lesson list's checkmarks. */
export function tutorialRoutes(app: FastifyInstance, sql: Sql): void {
  app.get('/api/tutorial', async (req, reply) => {
    const user = await requireUser(sql, req, reply);
    if (!user) return;
    const rows = await sql<{ lesson: string }[]>`SELECT lesson FROM tutorial WHERE user_id = ${user.id} ORDER BY done_at`;
    return { done: rows.map(r => r.lesson) };
  });

  app.post<{ Params: { lesson: string } }>('/api/tutorial/:lesson/done', async (req, reply) => {
    const user = await requireUser(sql, req, reply);
    if (!user) return;
    if (!IDS.has(req.params.lesson)) return reply.code(404).send({ error: 'No such lesson.' });
    await sql`INSERT INTO tutorial (user_id, lesson) VALUES (${user.id}, ${req.params.lesson}) ON CONFLICT DO NOTHING`;
    return { ok: true };
  });
}
