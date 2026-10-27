import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { authRoutes } from './auth';
import { WorldServer } from './worlds';
import type { Sql } from './db';
import { scriptRoutes } from './scripts';
import { tutorialRoutes } from './tutorial';

/** The whole server: accounts, saved scripts, and the worlds that run on it. */
export async function buildApp(sql: Sql, options: { logger?: boolean; tickMs?: number; nests?: number; shieldMs?: number } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  await app.register(websocket);
  const worlds = new WorldServer(sql, options.tickMs, options.nests, options.shieldMs);
  authRoutes(app, sql);
  scriptRoutes(app, sql);
  tutorialRoutes(app, sql);
  worlds.routes(app);
  return { app, worlds };
}
