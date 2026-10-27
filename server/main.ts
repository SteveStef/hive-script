// Starts the Hive Script server: npm run server (or npm run dev, with the web client).
import { buildApp } from './app';
import { connect, migrate } from './db';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.');
const port = Number(process.env.PORT ?? 3001);
const tickMs = Number(process.env.GAME_TICK_MS ?? 133); // 7.5 ticks a second: half single player's 1x

const sql = connect(url);
await migrate(sql);
const { app, worlds } = await buildApp(sql, { logger: true, tickMs });
await worlds.loadAll();
worlds.start(tickMs);
await app.listen({ port, host: '127.0.0.1' });
app.log.info(`game clock: one tick every ${tickMs} ms`);

// save every world before stopping, so no progress is lost on a restart
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await worlds.stop();
    await app.close();
    await sql.end();
    process.exit(0);
  });
}
