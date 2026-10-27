import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Sql } from './db';

export interface User {
  id: number;
  username: string;
}

const USERNAME = /^[a-z0-9_]{3,20}$/;
// owner_at() answers "you" for your own colony in single player and "wild" for wild wasps, so no player can be called either
const RESERVED_USERNAMES = ['you', 'wild'];
const MIN_PASSWORD = 8;
const SESSION_DAYS = 30;
const COOKIE = 'sid';

// Failed logins per username and address, so a password can't be guessed quickly.
const FAIL_LIMIT = 10;
const FAIL_WINDOW_MS = 60_000;
const failures = new Map<string, { count: number; resetAt: number }>();

function tooManyFailures(key: string): boolean {
  const f = failures.get(key);
  return !!f && f.resetAt > Date.now() && f.count >= FAIL_LIMIT;
}

function recordFailure(key: string): void {
  const f = failures.get(key);
  if (!f || f.resetAt <= Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + FAIL_WINDOW_MS });
  else f.count++;
}

/** The signed-in user for a request, from its session cookie, or null. */
export async function currentUser(sql: Sql, req: FastifyRequest): Promise<User | null> {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const [user] = await sql<User[]>`
    SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ${token} AND s.expires_at > now()`;
  return user ?? null;
}

/** For routes that need a signed-in user: answers 401 itself and returns null when there isn't one. */
export async function requireUser(sql: Sql, req: FastifyRequest, reply: FastifyReply): Promise<User | null> {
  const user = await currentUser(sql, req);
  if (!user) reply.code(401).send({ error: 'Please log in again.' });
  return user;
}

async function startSession(sql: Sql, reply: FastifyReply, userId: number): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await sql`INSERT INTO sessions (token, user_id, expires_at) VALUES (${token}, ${userId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  reply.setCookie(COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

type Credentials = { username?: unknown; password?: unknown };

export function authRoutes(app: FastifyInstance, sql: Sql): void {
  app.post<{ Body: Credentials }>('/api/signup', async (req, reply) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!USERNAME.test(username)) return reply.code(400).send({ error: 'Usernames are 3 to 20 characters: lowercase letters, numbers and _.' });
    if (RESERVED_USERNAMES.includes(username)) return reply.code(400).send({ error: `${username} means something in the game; pick another name.` });
    if (password.length < MIN_PASSWORD) return reply.code(400).send({ error: `Use a password of at least ${MIN_PASSWORD} characters.` });
    const passwordHash = await hash(password);
    const [user] = await sql<User[]>`
      INSERT INTO users (username, password_hash) VALUES (${username}, ${passwordHash})
      ON CONFLICT (lower(username)) DO NOTHING
      RETURNING id, username`;
    if (!user) return reply.code(409).send({ error: `The username ${username} is taken.` });
    await startSession(sql, reply, user.id);
    return { username: user.username };
  });

  app.post<{ Body: Credentials }>('/api/login', async (req, reply) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = `${req.ip}|${username}`;
    if (tooManyFailures(key)) return reply.code(429).send({ error: 'Too many tries. Wait a minute, then try again.' });
    const [row] = await sql<(User & { password_hash: string })[]>`SELECT id, username, password_hash FROM users WHERE lower(username) = ${username}`;
    if (!row || !(await verify(row.password_hash, password))) {
      recordFailure(key);
      return reply.code(401).send({ error: 'That username and password don\'t match.' });
    }
    failures.delete(key);
    await startSession(sql, reply, row.id);
    return { username: row.username };
  });

  app.post('/api/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await sql`DELETE FROM sessions WHERE token = ${token}`;
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const user = await requireUser(sql, req, reply);
    if (user) return { username: user.username };
  });
}
